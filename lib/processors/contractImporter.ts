import * as XLSX from "xlsx";

export async function importContracts(file: File) {
  const data = await file.arrayBuffer();

  const workbook = XLSX.read(data);

  console.log("SHEETS:", workbook.SheetNames);

  return workbook.SheetNames;
}