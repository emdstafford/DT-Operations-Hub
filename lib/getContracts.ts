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

export type ContractAssignmentPeriod = {
  contract_number: string;
  supervisor: string;
  start_date: string;
  end_date: string | null;
};

export async function getContractAssignmentPeriods(): Promise<ContractAssignmentPeriod[]> {
  const { data, error } = await supabase
    .from("contract_assignment_periods")
    .select("contract_number, supervisor, start_date, end_date");

  if (error) {
    throw error;
  }

  return (data ?? []) as ContractAssignmentPeriod[];
}
