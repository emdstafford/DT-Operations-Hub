import * as XLSX from "xlsx";

export async function processOperationalExceptions(
  file: File
) {
  const data = await file.arrayBuffer();

  const workbook = XLSX.read(data);

  const sheet =
    workbook.Sheets["Non-Compliant Loads"];

  if (!sheet) {
    return [];
  }

  const rows = XLSX.utils.sheet_to_json(
    sheet
  );

  return rows;
}