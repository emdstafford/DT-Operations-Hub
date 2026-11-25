import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { automationDatabase } from "@/lib/server/saveAutomatedFourKitesReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  const expected = process.env.AUTOMATION_INGEST_SECRET;
  const supplied = request.headers.get("x-dt-ingest-secret");
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}
function dateValue(value: unknown) {
  const day = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const d = new Date(day + "T00:00:00.000Z");
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0,10) === day ? day : null;
}
function count(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}
function table(wb: XLSX.WorkBook, name: string): unknown[][] {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error("Missing required worksheet: " + name);
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });
}
function header(row: unknown[]) { return row.map(v => String(v ?? "").trim().toLowerCase()); }
function find(row: unknown[], label: string) { return header(row).indexOf(label.toLowerCase()); }
function cleanContract(value: unknown) { return String(value ?? "").trim().toUpperCase().replace(/^0+(?=\d)/, ""); }

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  try {
    const body = await request.json();
    const start = dateValue(body.periodStart);
    const end = dateValue(body.periodEnd);
    const filename = String(body.fileName ?? "").trim().slice(0,200);
    const encoded = String(body.contentBytes ?? "");
    if (!start || !end || start > end || (Date.parse(end)-Date.parse(start))/86400000 > 13)
      return NextResponse.json({ok:false,error:"Valid weekly periodStart and periodEnd required"},{status:400});
    if (!/\.xlsx$/i.test(filename) || encoded.length < 100 || encoded.length > 10_000_000 || !/^[A-Za-z0-9+/=\r\n]+$/.test(encoded))
      return NextResponse.json({ok:false,error:"A valid XLSX attachment is required"},{status:400});
    const bytes = Buffer.from(encoded.replace(/\s/g,""), "base64");
    if (bytes.length > 7_500_000 || bytes.subarray(0,2).toString() !== "PK")
      return NextResponse.json({ok:false,error:"Unsupported workbook file"},{status:400});
    const hash = createHash("sha256").update(bytes).digest("hex");
    const wb = XLSX.read(bytes, {type:"buffer", cellDates:false});
    const supplier = table(wb, "Supplier Performance");
    const contracts = table(wb, "Contract Data");
    const noncompliant = table(wb, "Non-Compliant Loads");
    const supplierHeaderRow = supplier.findIndex(r=>Array.isArray(r) && find(r,"Total Stops with Geofence")>=0 && find(r,"Total Stops")>=0);
    if (supplierHeaderRow < 0) throw new Error("Unrecognized Supplier Performance headings");
    const sh = supplier[supplierHeaderRow];
    const carrierCol = find(sh,"Managing Carrier"), loadsCol = find(sh,"Total Loads");
    const totalCol = find(sh,"Total Stops"), geofenceCol=find(sh,"Total Stops with Geofence");
    const company = supplier.slice(supplierHeaderRow+1).find(r=>Array.isArray(r)&&String(r[carrierCol]??"").toUpperCase().includes("DAVENPORT TRANSPORTATION"));
    if (!company) throw new Error("Davenport company totals not found");
    const loads=count(company[loadsCol]), total=count(company[totalCol]), geofenced=count(company[geofenceCol]);
    if (loads===null || total===null || geofenced===null || total===0 || geofenced>total)
      throw new Error("Invalid company stop totals");
    const ch=contracts[0];
    if (!Array.isArray(ch)) throw new Error("Missing contract headings");
    const cc=find(ch,"Contract"), cl=find(ch,"Total Loads"), ct=find(ch,"Total Stops"), cg=find(ch,"Stops With Geofence");
    if ([cc,cl,ct,cg].some(i=>i<0)) throw new Error("Unrecognized Contract Data headings");
    const byContract: Record<string,{loads:number;totalStops:number;geofencedStops:number;missingStops:number;completionPercent:number}>={};
    for (const row of contracts.slice(1)) {
      if (!Array.isArray(row)) continue;
      const contract=cleanContract(row[cc]); if (!contract) continue;
      const l=count(row[cl]),t=count(row[ct]),g=count(row[cg]);
      if (l===null || t===null || g===null || g>t) throw new Error("Invalid totals for contract "+contract);
      if (byContract[contract]) throw new Error("Duplicate normalized contract: "+contract);
      byContract[contract]={loads:l,totalStops:t,geofencedStops:g,missingStops:t-g,completionPercent:t?Math.round(g/t*10000)/100:0};
    }
    if (!Object.keys(byContract).length) throw new Error("No contract data in workbook");
    const sum=(field:"totalStops"|"geofencedStops")=>Object.values(byContract).reduce((n,row)=>n+row[field],0);
    // A mismatch must not silently become an authoritative weekly email.
    if (sum("totalStops")!==total || sum("geofencedStops")!==geofenced)
      return NextResponse.json({ok:false,ready:false,error:"Contract totals do not reconcile to company totals",company:{total,geofenced},contracts:{total:sum("totalStops"),geofenced:sum("geofencedStops")}},{status:422});
    if (!Array.isArray(noncompliant[0]) || find(noncompliant[0],"Load Number")<0)
      throw new Error("Unrecognized Non-Compliant Loads headings");
    const exceptionCount=noncompliant.slice(1).filter(r=>Array.isArray(r) && String(r[find(noncompliant[0],"Load Number")]??"").trim()).length;
    const received=body.emailReceivedAt ? new Date(String(body.emailReceivedAt)) : null;
    if (received && !Number.isFinite(received.valueOf()))
      return NextResponse.json({ok:false,error:"Invalid emailReceivedAt"},{status:400});
    const db=automationDatabase();
    const {data,error}=await db.from("weekly_completion_imports").upsert({
      period_start:start, period_end:end, source_file:filename, source_sha256:hash,
      email_received_at:received?.toISOString()??null,company_loads:loads,
      company_total_stops:total,company_geofenced_stops:geofenced,
      contract_totals:byContract,noncompliant_load_count:exceptionCount,import_verified:true
    },{onConflict:"period_start,period_end,source_sha256"}).select("id,period_start,period_end,imported_at").single();
    if(error) throw error;
    return NextResponse.json({ok:true,ready:true,importId:data.id,periodStart:start,periodEnd:end,
      totalStops:total,geofencedStops:geofenced,missingStops:total-geofenced,
      completionPercent:Math.round(geofenced/total*10000)/100,
      contractCount:Object.keys(byContract).length,noncompliantLoadRows:exceptionCount,
      sourceSha256:hash});
  } catch (error) {
    // Do not leak implementation errors or request/attachment contents.
    return NextResponse.json({ok:false,ready:false,error:error instanceof Error && /^(Missing required|Unrecognized|Davenport|Invalid|No contract|Duplicate normalized)/.test(error.message)?error.message:"Unable to validate or save weekly workbook"},{status:422});
  }
}
