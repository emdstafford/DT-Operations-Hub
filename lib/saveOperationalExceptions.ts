import { supabase } from "./supabase";

export async function saveOperationalExceptions(
  rows: any[]
) {
  const records = rows
    .map((row) => ({
      load_number: Number(
        row["Load Number"]
      ),
      contract_number:
        String(row["Contract"] || ""),
      contract_trip:
        String(
          row["Contract Trip"] || ""
        ),
      status:
        String(row["Status"] || ""),
      tags:
        String(row["Tags"] || ""),
      geofence_non_compliance:
        String(
          row["Geofence Non compliance"] || ""
        ),
      ping_frequency_non_compliance:
        String(
          row["Ping frequency Non compliance"] ||
            ""
        ),
    }))
    .filter(
      (r) =>
        r.load_number &&
        r.contract_number
    );

  const { error } = await supabase
    .from("operational_exceptions")
    .upsert(records, {
      onConflict: "load_number",
    });

  if (error) {
    throw error;
  }

  return records.length;
}