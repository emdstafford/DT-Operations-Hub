import { supabase } from "./supabase";

export async function getCompletionTotals() {
  const { data, error } = await supabase
    .from("weekly_contract_summary")
    .select("*");

  if (error) {
    throw error;
  }

  return data;
}