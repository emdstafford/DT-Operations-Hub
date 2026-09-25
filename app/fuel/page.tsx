import FuelReports from "@/components/FuelReports";

export default function FuelReportsPage() {
  return <main className="page-shell fuel-page">
    <header className="page-intro">
      <div><p className="eyebrow">Fuel intelligence</p><h1>Fuel Reports</h1><p>Pick a day, week, or month. Find a contract and tap it to see fuel spend and purchases.</p></div>
    </header>
    <FuelReports />
  </main>;
}
