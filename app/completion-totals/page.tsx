import { supabase } from "@/lib/supabase";

export default async function CompletionTotalsPage() {
  const { data: contractData } = await supabase
    .from("weekly_contract_summary")
    .select("*");

  const { data: supervisorData } = await supabase
    .from("contract_supervisors")
    .select("*");

  const rows = contractData ?? [];
  const supervisors = supervisorData ?? [];

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

  
  const reportDate =
    rows[0]?.report_date ?? "";

  const periodStart =
    rows[0]?.period_start ??
    reportDate;

  const periodEnd =
    rows[0]?.period_end ??
    reportDate;

  const contracts = [...rows].sort(

    (a, b) =>
      a.completion_percent - b.completion_percent
  );

  const contractsFound = contracts.length;

  const contractsBelow90 = contracts.filter(
    (c) => c.completion_percent < 0.9
  ).length;

  const supervisorMap = new Map();

  contracts.forEach((contract) => {
    const supervisorRecord = supervisors.find(
      (s) =>
        s.contract_number ===
        contract.contract_number
    );

    if (!supervisorRecord) return;

    const supervisorNames = String(
      supervisorRecord.supervisor || ""
    )
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter(
        (s) => s !== "Candi Tanner"
      );

    supervisorNames.forEach((supervisor) => {

      if (!supervisorMap.has(supervisor)) {
        supervisorMap.set(supervisor, {
          total: 0,
          completed: 0,
          contracts: 0,
        });
      }

      const current =
        supervisorMap.get(supervisor);

      current.total +=
        contract.total_stops || 0;

      current.completed +=
        contract.stops_completed || 0;

      current.contracts += 1;

    });
  });

  const supervisorRankings =
    Array.from(supervisorMap.entries())
      .map(([name, values]) => ({
        name,
        percent:
          values.total > 0
            ? values.completed /
              values.total
            : 0,
      }))
      .sort(
        (a, b) => b.percent - a.percent
      );

  return (
    <main className="min-h-screen bg-slate-100 p-8">
      <div className="bg-white p-6 rounded shadow">

        <h1 className="text-3xl font-bold mb-2">
          Completion Totals
        </h1>

        <div className="text-slate-600 mb-6">
          Reporting Period:
          {" "}
          {String(periodStart)}
          {" "}
          -
          {" "}
          {String(periodEnd)}
        </div>

        <div className="grid grid-cols-6 gap-4 mb-8">

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

          <div className="bg-purple-100 p-4 rounded">
            <div>Contracts Found</div>
            <div className="text-3xl font-bold">
              {contractsFound}
            </div>
          </div>

          <div className="bg-orange-100 p-4 rounded">
            <div>Below 90%</div>
            <div className="text-3xl font-bold">
              {contractsBelow90}
            </div>
          </div>

        </div>

        <div className="grid grid-cols-2 gap-8">

          <div>

            <h2 className="text-2xl font-bold mb-4">
              Supervisor Rankings
            </h2>

            <table className="w-full border">

              <thead>
                <tr className="bg-slate-200">
                  <th className="border p-2">
                    Supervisor
                  </th>

                  <th className="border p-2">
                    %
                  </th>
                </tr>
              </thead>

              <tbody>

                {supervisorRankings.map(
                  (s, i) => (
                    <tr
                      key={s.name}
                      className={
                        i < 5
                          ? "bg-green-100"
                          : ""
                      }
                    >
                      <td className="border p-2">
                        {s.name}
                      </td>

                      <td className="border p-2">
                        {(s.percent * 100).toFixed(
                          2
                        )}
                        %
                      </td>
                    </tr>
                  )
                )}

              </tbody>

            </table>

          </div>

          <div>

            <h2 className="text-2xl font-bold mb-4">
              Contract Rankings
            </h2>

            <table className="w-full border">

              <thead>
                <tr className="bg-slate-200">
                  <th className="border p-2">
                    Contract
                  </th>

                  <th className="border p-2">
                    %
                  </th>

                  <th className="border p-2">
                    Incomplete
                  </th>
                </tr>
              </thead>

              <tbody>

                {contracts.map((c, i) => (
                  <tr
                    key={c.contract_number}
                    className={
                      i < 10
                        ? "bg-red-100"
                        : ""
                    }
                  >
                    <td className="border p-2">
                      {c.contract_number}
                    </td>

                    <td className="border p-2">
                      {(c.completion_percent * 100).toFixed(2)}%
                    </td>

                    <td className="border p-2">
                      {c.stops_incomplete}
                    </td>
                  </tr>
                ))}

              </tbody>

            </table>

          </div>

        </div>

      </div>
    </main>
  );
}
