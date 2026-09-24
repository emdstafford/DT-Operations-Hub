import FuelReports from "@/components/FuelReports";

export default function FuelReportsPage() {
  return <main className="page-shell fuel-page">
    <header className="page-intro">
      <div><p className="eyebrow">Restricted financial operations</p><h1>Fuel Reports</h1><p>Review Comdata fuel activity by date, contract, employee, station, vehicle, and fuel type.</p></div>
    </header>
    <FuelReports />
  </main>;
}
