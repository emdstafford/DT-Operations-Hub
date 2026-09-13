import { supabase } from "./supabase";

export async function saveUploadHistory(
  fileName: string,
  rowsProcessed: number,
  contractsFound: number,
  reportType: string
) {
  const { error } = await supabase
    .from("upload_history")
    .insert({
      source_file: fileName,
      report_type: reportType,
      rows_processed: rowsProcessed,
      contracts_found: contractsFound,
    });

  if (error) {
    throw error;
  }
}