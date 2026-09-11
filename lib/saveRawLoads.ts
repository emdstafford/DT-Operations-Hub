import { supabase } from "./supabase";

export async function saveRawLoads(
  rows: any[]
) {
  const records = rows
    .filter((row) => row["Load Number"])
    .map((row) => ({
      load_number: Number(row["Load Number"]),
      stops_count: Number(
        row["Stops Count"] || 0
      ),
      stops_completed: Number(
        row["Stops With Timestamp"] || 0
      ),
      stops_incomplete: Number(
        row["Incomplete Stops"] || 0
      ),
      report_date: new Date()
        .toISOString()
        .split("T")[0],
    }));

  const { error } = await supabase
    .from("raw_loads")
    .upsert(records, {
      onConflict: "load_number",
    });

  if (error) {
    throw error;
  }

  return records.length;
}