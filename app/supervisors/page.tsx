import { supabase } from "@/lib/supabase";

export default async function SupervisorsPage() {
  const { data: contractsData } = await supabase
    .from("weekly_contract_summary")
    .select("*");

  const { data: supervisorData } = await supabase
    .from("contract_supervisors")
    .select("*");

  const contracts = contractsData ?? [];
  const supervisors = supervisorData ?? [];

  const reportDate =
    contracts[0]?.report_date ??
    "No Report Date";

  const periodStart =
    contracts[0]?.period_start ??
    reportDate;

  const periodEnd =
    contracts[0]?.period_end ??
    reportDate;

  const supervisorMap = new Map();

  contracts.forEach((contract) => {

    const sup = supervisors.find(
      (s) =>
        s.contract_number ===
        contract.contract_number
    );

    if (!sup) return;

    const names = String(
      sup.supervisor || ""
    )
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter(
        (s) => s !== "Candi Tanner"
      );

    names.forEach((name) => {

      if (!supervisorMap.has(name)) {
        supervisorMap.set(name, {
          contracts: [],
          totalStops: 0,
          completed: 0,
          incomplete: 0,
        });
      }

      const current =
        supervisorMap.get(name);

      const exists = current.contracts.some(
  (c: any) =>
    c.contract_number ===
    contract.contract_number
);

if (!exists) {
  current.contracts.push(contract);

  current.totalStops +=
    contract.total_stops || 0;

  current.completed +=
    contract.stops_completed || 0;

  current.incomplete +=
    contract.stops_incomplete || 0;
}
    });
  });
  const rankings =
    Array.from(supervisorMap.entries())
      .map(([name, values]) => ({
        name,
        ...values,
        contractCount:
          values.contracts.length,
        percent:
          values.totalStops > 0
            ? values.completed /
              values.totalStops
            : 0,
      }))
      .sort(
        (a, b) => b.percent - a.percent
      );

  return (
    <main className="min-h-screen bg-slate-100 p-8">

      <div className="bg-white rounded-lg shadow p-6">

        <h1 className="text-3xl font-bold mb-2">
          Supervisor Performance
        </h1>

        <div className="mb-6 text-slate-600">
          Reporting Period:
          {" "}
          {String(periodStart)}
          {" "}
          -
          {" "}
          {String(periodEnd)}
        </div>

        {rankings.map((sup, index) => (

          <div
            key={sup.name}
            className="mb-8 border rounded p-4 bg-white"
          >

            <div
              className={`p-4 rounded mb-4 ${
                index < 5
                  ? "bg-green-100"
                  : "bg-slate-100"
              }`}
            >

              <div className="text-xl font-bold">

                #{index + 1}

                {" "}

                {sup.name}

              </div>

              <div>
                Contracts:
                {" "}
                {sup.contractCount}
              </div>

              <div>
                Stops:
                {" "}
                {sup.totalStops.toLocaleString()}
              </div>

              <div>
                Completed:
                {" "}
                {sup.completed.toLocaleString()}
              </div>

              <div>
                Missed:
                {" "}
                {sup.incomplete.toLocaleString()}
              </div>

              <div className="font-bold">

                Completion:
                {" "}

                {(sup.percent * 100).toFixed(2)}%

              </div>

            </div>

            <table className="w-full border">

              <thead>

                <tr className="bg-slate-200">

                  <th className="border p-2">
                    Contract
                  </th>

                  <th className="border p-2">
                    Stops
                  </th>

                  <th className="border p-2">
                    Completed
                  </th>

                  <th className="border p-2">
                    Missed
                  </th>

                  <th className="border p-2">
                    %
                  </th>

                </tr>

              </thead>

              <tbody>

                {sup.contracts
                  .sort(
                    (a: any, b: any) =>
                      a.completion_percent -
                      b.completion_percent
                  )
                  .map((c: any) => (

                    <tr
                      key={c.contract_number}
                    >

                      <td className="border p-2">
                        {c.contract_number}
                      </td>

                      <td className="border p-2">
                        {c.total_stops}
                      </td>

                      <td className="border p-2">
                        {c.stops_completed}
                      </td>

                      <td className="border p-2">
                        {c.stops_incomplete}
                      </td>

                      <td className="border p-2">
                        {(c.completion_percent * 100).toFixed(2)}%
                      </td>

                    </tr>

                  ))}

              </tbody>

            </table>

          </div>

        ))}

      </div>

    </main>
  );
}
