import Link from "next/link";

export default function InsightsPage() {
  return <main className="page-shell"><section className="empty-state"><div className="empty-icon">DT</div><h1>Performance insights</h1><p>Daily, weekly, and monthly trends will appear here as historical reports are imported.</p><Link className="primary-link" href="/upload">Import report history</Link></section></main>;
}
