import { getCompletionTotals } from "@/lib/getCompletionTotals";

export default async function CompletionTotalsPage() {
  const contracts = await getCompletionTotals();

  const totalStops = contracts.reduce(
    (sum, row) => sum + (row.total_stops ?? 0),
    0
  );

  const completedStops = contracts.reduce(
    (sum, row) => sum + (row.stops_completed ?? 0),
    0
  );

  const incompleteStops = contracts.reduce(
    (sum, row) => sum + (row.stops_incomplete ?? 0),
    0
  );

  const overallCompletion =
    totalStops > 0
      ? (completedStops / totalStops) * 100
      : 0;

  return (
    <main className="min-h-screen bg-slate-100 p-8">
      <div className="bg-white rounded-lg shadow p-6">
        <h1 className="text-3xl font-bold">
          Completion Totals
        </h1>

        <div className="grid grid-cols-4 gap-4 mt-6">
          <div className="bg-slate-100 p-4 rounded">
            <div>Overall Completion</div>
            <div className="text-2xl font-bold">
              {overallCompletion.toFixed(2)}%
            </div>
          </div>

          <div className="bg-slate-100 p-4 rounded">
            <div>Total Stops</div>
            <div className="text-2xl font-bold">
              {totalStops.toLocaleString()}
            </div>
          </div>

          <div className="bg-slate-100 p-4 rounded">
            <div>Completed Stops</div>
            <div className="text-2xl font-bold">
              {completedStops.toLocaleString()}
            </div>
          </div>

          <div className="bg-slate-100 p-4 rounded">
            <div>Incomplete Stops</div>
            <div className="text-2xl font-bold">
              {incompleteStops.toLocaleString()}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}