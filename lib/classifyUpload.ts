import type { UploadKind } from "@/components/UploadHandoff";

export async function classifyUpload(file: File): Promise<UploadKind> {
  if (/\.pdf$/i.test(file.name)) return "schedule";
  if (/\.csv$/i.test(file.name)) {
    const first = (await file.slice(0, 4096).text()).toLowerCase();
    if (first.includes("worked department") && (first.includes("in time") || first.includes("out time"))) return "timecards";
    if (first.includes("file number") && first.includes("hours")) return "holiday";
    return "unknown";
  }
  if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) return "unknown";
  const XLSX = await import("xlsx");
  const book = XLSX.read(await file.arrayBuffer(), { type: "array", sheetRows: 100 });
  if (book.SheetNames.includes("Load Details") || book.SheetNames.includes("Non-Compliant Loads")) return "usps";
  for (const name of book.SheetNames.slice(0, 5)) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: "", raw: false });
    const text = grid.slice(0, 30).map((row) => row.join("|").toLowerCase()).join("|");
    if (text.includes("annual miles (calculated)") && text.includes("hcr*")) return "fuel_contracts";
    if (text.includes("transaction number") && text.includes("misc 2") && text.includes("net cost")) return "fuel_comdata";
    if (text.includes("worked department") && text.includes("in time") && text.includes("hours")) return "timecards";
  }
  return "unknown";
}
