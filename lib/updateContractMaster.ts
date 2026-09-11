import { supabase } from "./supabase";

export async function updateContractMaster(
  contracts: any[]
) {
  const today = new Date()
    .toISOString()
    .split("T")[0];

  for (const contract of contracts) {
    const contractNumber = contract.contract;

    const { data } = await supabase
      .from("contract_master")
      .select("*")
      .eq("contract_number", contractNumber)
      .maybeSingle();

    if (!data) {
      await supabase
        .from("contract_master")
        .insert({
          contract_number: contractNumber,
          active: true,
          first_seen: today,
          last_seen: today,
        });
    } else {
      await supabase
        .from("contract_master")
        .update({
          active: true,
          last_seen: today,
        })
        .eq("contract_number", contractNumber);
    }
  }

  return true;
}