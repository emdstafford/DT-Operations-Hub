export default function Home() {
  return (
    <main className="min-h-screen bg-slate-100">
      <header className="bg-[#0A2342] text-white p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-4xl font-bold">
            DT Operations Hub
          </h1>

          <p className="text-slate-300">
            Davenport Transportation
          </p>
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card title="Overall Completion" value="94.66%" />
          <Card title="Geofence Compliance" value="94.25%" />
          <Card title="Total Stops" value="30,831" />
          <Card title="Incomplete Stops" value="1,646" />
        </div>

        <div className="grid md:grid-cols-2 gap-6 mt-6">
          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="text-xl font-bold mb-4">
              AI Daily Brief
            </h2>

            <p>
              Overall completion remains above target.
              Geofence compliance remains strong.
              Contract 296C2 continues to perform well.
            </p>
          </div>

          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="text-xl font-bold mb-4">
              Top Supervisors
            </h2>

            <ul className="space-y-2">
              <li>🏆 Tonya Capps-Owen</li>
              <li>🥈 Ronnie Wooldridge</li>
              <li>🥉 Kevin Shields</li>
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}

function Card({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div className="bg-white rounded-xl shadow p-6">
      <p className="text-slate-500">{title}</p>
      <h3 className="text-4xl font-bold mt-3">{value}</h3>
    </div>
  );
}