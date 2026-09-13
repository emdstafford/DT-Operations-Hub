import { supabase } from "@/lib/supabase";

export default async function CompletionTotalsPage() {
  const { data } = await supabase
    .from("weekly_contract_summary")
    .select("*");

  const rows = data ?? [];

  const totalStops = rows.reduce(
    (sum, r) => sum + (r.total_stops || 0),
    0
  );

  const completedStops = rows.reduce(
    (sum, r) => sum + (r.stops_completed || 0),
    0
  );

  const incompleteStops = rows.reduce(
    (sum, r) => sum + (r.stops_incomplete || 0),
    0
  );

  const completion =
    totalStops > 0
      ? ((completedStops / totalStops) * 100).toFixed(2)
      : "0.00";

  const contracts = [...rows].sort(
    (a, b) =>
      a.completion_percent - b.completion_percent
  );

  return (
    <main className="min-h-screen bg-slate-100 p-8">
      <div className="bg-white p-6 rounded shadow">

        <h1 className="text-3xl font-bold mb-6">
          Completion Totals
        </h1>

        <div className="grid grid-cols-4 gap-4 mb-8">

          <div className="bg-blue-100 p-4 rounded">
            <div>Overall Completion</div>
            <div className="text-3xl font-bold">
              {completion}%
            </div>
          </div>

          <div className="bg-green-100 p-4 rounded">
            <div>Total Stops</div>
            <div className="text-3xl font-bold">
              {totalStops.toLocaleString()}
            </div>
          </div>

          <div className="bg-yellow-100 p-4 rounded">
            <div>Completed</div>
            <div className="text-3xl font-bold">
              {completedStops.toLocaleString()}
            </div>
          </div>

          <div className="bg-red-100 p-4 rounded">
            <div>Incomplete</div>
            <div className="text-3xl font-bold">
              {incompleteStops.toLocaleString()}
            </div>
          </div>

        </div>

        <h2 className="text-2xl font-bold mb-4">
          Contract Rankings
        </h2>

        <table className="w-full border">
          <thead>
            <tr className="bg-slate-200">
              <th className="border p-2">Contract</th>
              <th className="border p-2">%</th>
              <th className="border p-2">Stops</th>
              <th className="border p-2">Incomplete</th>
            </tr>
          </thead>

          <tbody>
            {contracts.map((c, i) => (
              <tr
                key={c.contract_number}
                className={
                  i < 10 ? "bg-red-100" : ""
                }
              >
                <td className="border p-2">
                  {c.contract_number}
                </td>

                <td className="border p-2">
                  {(c.completion_percent * 100).toFixed(2)}%
                </td>

                <td className="border p-2">
                  {c.total_stops}
                </td>

                <td className="border p-2">
                  {c.stops_incomplete}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

      </div>
    </main>
  );
}