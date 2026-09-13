import Link from "next/link";

export default function GeofencePage() {
  return <main className="page-shell"><section className="empty-state"><div className="empty-icon">MS</div><h1>Geofence and missed stops</h1><p>Use the Missed Stops upload to review geofence compliance by load, contract, trip, and location.</p><Link className="primary-link" href="/operational-exceptions">Open Missed Stops</Link></section></main>;
}
