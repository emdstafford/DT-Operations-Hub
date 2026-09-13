import { supabase } from "./supabase";
import { extractTrip } from "./extractTrip";

export async function saveRawContractLoads(
  rows: any[]
) {
  const records = rows
    .map((row) => {
      const tags = String(
        row["Tags"] || ""
      );

      const tripInfo =
        extractTrip(tags);

      if (!tripInfo) return null;

      return {
        load_number: Number(
          row["Load Number"]
        ),
        contract_number:
          tripInfo.contract,
        trip_number:
          tripInfo.trip,
        stops_count:
          Number(
            row["Stops Count"] || 0
          ),
        stops_completed:
          Number(
            row["Stops With Timestamp"] || 0
          ),
        stops_incomplete:
          Number(
            row["Incomplete Stops"] || 0
          ),
        report_date: new Date()
          .toISOString()
          .split("T")[0],
      };
    })
    .filter(Boolean);

  // Remove duplicate load numbers
  const uniqueRecords = Array.from(
    new Map(
      records.map((r: any) => [
        r.load_number,
        r,
      ])
    ).values()
  );

  const { error } = await supabase
    .from("raw_contract_loads")
    .upsert(uniqueRecords, {
      onConflict: "load_number",
    });

  if (error) {
    throw error;
  }

  return uniqueRecords.length;
}