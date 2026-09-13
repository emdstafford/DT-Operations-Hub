import { supabase } from "./supabase";

export async function getContracts() {
  const { data, error } = await supabase
    .from("contract_supervisors")
    .select("contract_number, supervisor");

  if (error) {
    throw error;
  }

  return data ?? [];
}
