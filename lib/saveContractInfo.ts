import { supabase } from "./supabase";

function convertExcelDate(value: any) {
  if (!value) return null;

  if (typeof value === "number") {
    const excelEpoch = new Date(
      Date.UTC(1899, 11, 30)
    );

    excelEpoch.setUTCDate(
      excelEpoch.getUTCDate() + value
    );

    return excelEpoch
      .toISOString()
      .split("T")[0];
  }

  return value;
}

export async function saveContractInfo(
  rows: any[]
) {
  const contracts = rows
    .filter((row) => row["Contract"])
    .map((row) => ({
      contract_number: row["Contract"],
      supervisor: row["Supervisor"],
      region: row["Region"],
      start_date: convertExcelDate(
        row["Start Date"]
      ),
      end_date: convertExcelDate(
        row["End Date"]
      ),
      active: true,
      source: "Contract Info Import",
    }));

  const { error } = await supabase
    .from("contract_supervisors")
    .upsert(contracts, {
      onConflict: "contract_number",
    });

  if (error) {
    throw error;
  }

  return contracts.length;
}