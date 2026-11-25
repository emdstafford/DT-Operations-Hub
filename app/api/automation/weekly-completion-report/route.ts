import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { automationDatabase } from "@/lib/server/saveAutomatedFourKitesReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const expected=process.env.AUTOMATION_INGEST_SECRET;
  const supplied=request.headers.get("x-dt-ingest-secret");
  if (!expected || !supplied) return false;
  const a=Buffer.from(expected), b=Buffer.from(supplied);
  return a.length===b.length && timingSafeEqual(a,b);
}
const esc=(value:unknown)=>String(value??"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]??c));
type Contract={loads:number;totalStops:number;geofencedStops:number;missingStops:number;completionPercent:number};

export async function GET(request:Request) {
  if (!authorized(request)) return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
  const day=new URL(request.url).searchParams.get("periodEnd")??"";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(day+"T00:00:00Z").toISOString().slice(0,10)!==day)
    return NextResponse.json({ok:false,error:"Valid periodEnd required"},{status:400});
  try {
    const db=automationDatabase();
    const {data,error}=await db.from("weekly_completion_imports")
      .select("id,period_start,period_end,source_file,source_sha256,imported_at,email_received_at,company_loads,company_total_stops,company_geofenced_stops,contract_totals,noncompliant_load_count,import_verified")
      .eq("period_end",day).eq("import_verified",true)
      .order("imported_at",{ascending:false}).limit(1);
    if(error) throw error;
    const report=data?.[0];
    if(!report) return NextResponse.json({ok:true,ready:false,periodEnd:day,reason:"Sunday weekly workbook not yet imported"},{headers:{"Cache-Control":"no-store"}});
    const totals=report.contract_totals as Record<string,Contract>;
    const contracts=Object.entries(totals??{}).map(([contract,value])=>({contract,...value}))
      .sort((a,b)=>a.completionPercent-b.completionPercent || a.contract.localeCompare(b.contract));
    const percent=Math.round(report.company_geofenced_stops/report.company_total_stops*10000)/100;
    const low=contracts.filter(c=>c.totalStops>0&&c.completionPercent<95);
    const rows=contracts.map(c=>`<tr><td style="padding:6px;border-bottom:1px solid #ddd">${esc(c.contract)}</td><td style="padding:6px;border-bottom:1px solid #ddd;text-align:right">${c.totalStops}</td><td style="padding:6px;border-bottom:1px solid #ddd;text-align:right">${c.missingStops}</td><td style="padding:6px;border-bottom:1px solid #ddd;text-align:right">${c.completionPercent.toFixed(2)}%</td></tr>`).join("");
    const html=`<div style="font-family:Arial,sans-serif;max-width:820px;color:#16243a"><h2>DT Hub | Weekly Completion Report</h2>
      <p>Reporting period: <b>${esc(report.period_start)} – ${esc(report.period_end)}</b></p>
      <p><b>Weekly completion: ${percent.toFixed(2)}%</b><br>Countable stops: ${report.company_total_stops.toLocaleString()}<br>
      Stops with geofence: ${report.company_geofenced_stops.toLocaleString()}<br>
      Missing geofence: ${(report.company_total_stops-report.company_geofenced_stops).toLocaleString()}<br>
      Contracts below 95%: ${low.length}</p>
      <p style="font-size:12px;color:#666">These are the countable totals in the Sunday FourKites workbook, which may differ from the preliminary daily report. No additional USPS credits are inferred.</p>
      <table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr style="background:#edf2f7"><th align="left">Contract</th><th align="right">Stops</th><th align="right">Missing</th><th align="right">Completion</th></tr></thead><tbody>${rows}</tbody></table>
      <p style="font-size:12px;color:#666">Source: ${esc(report.source_file)}</p></div>`;
    return NextResponse.json({ok:true,ready:true,periodStart:report.period_start,periodEnd:report.period_end,
      sourceFile:report.source_file,importedAt:report.imported_at,sourceSha256:report.source_sha256,
      company:{loads:report.company_loads,totalStops:report.company_total_stops,geofencedStops:report.company_geofenced_stops,
        missingStops:report.company_total_stops-report.company_geofenced_stops,completionPercent:percent},
      contracts,contractsBelow95:low.length,noncompliantLoadRows:report.noncompliant_load_count,
      emailSubject:`DT Hub Weekly Completion Report | ${report.period_start} to ${report.period_end} | ${percent.toFixed(2)}%`,
      emailHtml:html},{headers:{"Cache-Control":"no-store"}});
  } catch {
    return NextResponse.json({ok:false,ready:false,error:"Could not retrieve verified weekly completion report"},{status:503});
  }
}
