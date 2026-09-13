import { supabase } from "@/lib/supabase";

export default async function ContractPage({
  params,
}: {
  params: Promise<{ contract: string }>;
}) {
  const { contract } = await params;

  const { data } = await supabase
    .from("weekly_contract_summary")
    .select("*")
    .eq("contract_number", contract)
    .single();

  if (!data) {
    return (
      <main className="p-8">
        <h1>Contract not found</h1>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-8">
      <div className="bg-white rounded-lg shadow p-6">

        <h1 className="text-3xl font-bold mb-2">
          Contract {contract}
        </h1>

        <div className="grid grid-cols-4 gap-4 mt-6">

          <div className="bg-blue-100 p-4 rounded">
            <div>Stops</div>
            <div className="text-2xl font-bold">
              {data.total_stops}
            </div>
          </div>

          <div className="bg-green-100 p-4 rounded">
            <div>Completed</div>
            <div className="text-2xl font-bold">
              {data.stops_completed}
            </div>
          </div>

          <div className="bg-red-100 p-4 rounded">
            <div>Missed</div>
            <div className="text-2xl font-bold">
              {data.stops_incomplete}
            </div>
          </div>

          <div className="bg-yellow-100 p-4 rounded">
            <div>Completion</div>
            <div className="text-2xl font-bold">
              {(data.completion_percent * 100).toFixed(2)}%
            </div>
          </div>

        </div>

        <div className="mt-8 p-4 bg-yellow-50 rounded border">
          Next Step:
          This page will show all missed loads,
          tracking issues, and root causes for this contract.
        </div>

      </div>
    </main>
  );
}
