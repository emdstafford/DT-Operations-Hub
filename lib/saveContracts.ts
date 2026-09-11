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

  console.log("ROWS TO SAVE", rows);

  const result = await supabase
    .from("weekly_contract_summary")
    .insert(rows);

  console.log("SUPABASE RESULT", result);

  if (result.error) {
    throw new Error(
      JSON.stringify(result.error)
    );
  }

  return true;
}