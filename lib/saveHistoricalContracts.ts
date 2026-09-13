import { supabase } from "./supabase";

export async function saveHistoricalContracts(
  contracts: any[],
  fileName: string
) {
  const dateMatches =
    fileName.match(
      /(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})/
    );

  const periodStart =
    dateMatches?.[1] ?? null;

  const periodEnd =
    dateMatches?.[2] ?? null;

  const rows = contracts.map((contract) => ({
    contract_number: contract.contract,
    total_stops: contract.totalStops,
    stops_completed: contract.completedStops,
    stops_incomplete: contract.incompleteStops,
    completion_percent:
      contract.percentComplete,
    period_start: periodStart,
    period_end: periodEnd,
    source_file: fileName,
  }));

  const { error } = await supabase
    .from("contract_history")
    .insert(rows);

  if (error) {
    throw error;
  }

  return rows.length;
}