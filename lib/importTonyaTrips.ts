import { supabase } from "./supabase";

export async function importTonyaTrips() {
  const b8Trips = [
    7,8,9,10,11,12,13,14,15,16,17,18,19,20,
    21,22,23,24,25,26,29,30,33,34,39,40,
    41,42,43,44,45,46,321,322
  ];

  const c2Trips = [
    77,78,79,80,81,82,83,84,85,86,87,88,
    89,90,91,92,93,94,95,96,97,98,
    157,158,159,160,161,162,163,164,
    165,166,167,168,169,1017,170,
    1018,1019,1020
  ];

  const records = [];

  for (const trip of b8Trips) {
    records.push({
      contract_number: "296B8",
      trip_number: String(trip),
      supervisor: "Tonya Capps-Owen",
    });
  }

  for (const trip of c2Trips) {
    records.push({
      contract_number: "296C2",
      trip_number: String(trip),
      supervisor: "Tonya Capps-Owen",
    });
  }

  const { error } = await supabase
    .from("trip_supervisor_assignments")
    .upsert(records);

  if (error) {
    throw error;
  }

  return records.length;
}