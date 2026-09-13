import { supabase } from "./supabase";

export async function getDashboardData() {
  const { data: contractsData, error } =
    await supabase
      .from("weekly_contract_summary")
      .select("*");

  if (error) {
    throw error;
  }

  const contracts = contractsData ?? [];

  const totalStops = contracts.reduce(
    (sum, c) => sum + (c.total_stops || 0),
    0
  );

  const completedStops = contracts.reduce(
    (sum, c) => sum + (c.stops_completed || 0),
    0
  );

  const incompleteStops = contracts.reduce(
    (sum, c) => sum + (c.stops_incomplete || 0),
    0
  );

  const completion =
    totalStops > 0
      ? (
          (completedStops / totalStops) *
          100
        ).toFixed(2)
      : "0.00";

  const contractsBelow90 =
    contracts.filter(
      (c) =>
        (c.completion_percent || 0) < 0.9
    ).length;

  const lowestContracts = [...contracts]
    .sort(
      (a, b) =>
        (a.completion_percent || 0) -
        (b.completion_percent || 0)
    )
    .slice(0, 10);

  const { data: supervisorData } =
    await supabase
      .from("contract_supervisors")
      .select("*");

  const supervisors = supervisorData ?? [];

  const supervisorCounts = new Map();

  supervisors.forEach((row: any) => {
    const names = String(
      row.supervisor || ""
    )
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter(
        (s) => s !== "Candi Tanner"
      );

    names.forEach((name) => {
      supervisorCounts.set(
        name,
        (supervisorCounts.get(name) || 0) + 1
      );
    });
  });

  const topSupervisors = Array.from(
    supervisorCounts.entries()
  )
    .map(([name, contracts]) => ({
      name,
      contracts,
    }))
    .sort(
      (a, b) => b.contracts - a.contracts
    )
    .slice(0, 10);

  return {
    completion,
    totalStops,
    completedStops,
    incompleteStops,
    contractsFound: contracts.length,
    contractsBelow90,
    lowestContracts,
    topSupervisors,
  };
}