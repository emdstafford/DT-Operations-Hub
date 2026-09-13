export default function MissedStopsPage() {
  return (
    <main className="min-h-screen bg-slate-100 p-8">
      <div className="bg-white rounded-lg shadow p-6">

        <h1 className="text-3xl font-bold mb-4">
          Missed Stops Report
        </h1>

        <div className="bg-yellow-100 p-4 rounded mb-6">
          Sunday Missed Stops Analysis
        </div>

        <div>
          Upload Missed Stops report to identify:
        </div>

        <ul className="list-disc ml-6 mt-4">
          <li>Contract impact</li>
          <li>Supervisor impact</li>
          <li>Root causes</li>
          <li>Problem loads</li>
          <li>Recurring issues</li>
        </ul>

      </div>
    </main>
  );
}
