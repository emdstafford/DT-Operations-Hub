import { supabase } from "./supabase";

export async function saveContractsToDatabase(
  contracts: any[]
) {
  const rows = contracts.map((contract) => ({
    contract_number: contract.contract,
    total_stops: contract.totalStops,
    stops_completed: contract.completedStops,
    stops_incomplete: contract.incompleteStops,
    completion_percent: contract.percentComplete,
    report_date: new Date()
      .toISOString()
      .split("T")[0],
  }));

  console.log("ROWS TO SAVE:");
  console.log(rows);

  const { data, error } = await supabase
    .from("weekly_contract_summary")
    .insert(rows)
    .select();

  console.log("SAVE DATA:");
  console.log(data);

  console.log("SAVE ERROR:");
  console.log(error);

  if (error) {
    throw error;
  }

  return true;
}