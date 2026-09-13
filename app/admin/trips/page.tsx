"use client";

import { importTonyaTrips } from "@/lib/importTonyaTrips";

export default function TripsAdmin() {

  async function handleImport() {
    try {
      const count =
        await importTonyaTrips();

      alert(
        `${count} trip assignments imported`
      );
    } catch (err: any) {
  console.error(err);

  alert(
    err?.message ||
    JSON.stringify(err)
  );
}

  }

  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold">
        Trip Assignments
      </h1>

      <button
        onClick={handleImport}
        className="bg-blue-500 text-white px-4 py-2 rounded mt-4"
      >
        Import Tonya Trips
      </button>
    </main>
  );
}