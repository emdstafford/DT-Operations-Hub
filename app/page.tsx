import Link from "next/link";

const areas = [
  { title: "TQ reporting", text: "Upload weekly or daily FourKites reports and calculate unique-load performance.", href: "/upload", action: "Upload report" },
  { title: "Completion totals", text: "Review overall, contract, and supervisor completion for the selected period.", href: "/completion-totals", action: "View completion" },
  { title: "Missed stops", text: "Import Sunday geofence reports and investigate missing stops by location and trip.", href: "/operational-exceptions", action: "Review missed stops" },
];

export default function HomePage() {
  return (
    <main className="page-shell">
      <header className="dashboard-hero">
        <div><p className="eyebrow eyebrow-light">Davenport Transportation</p><h1>Operations performance, clearly organized.</h1><p>Turn TQ and missed-stop files into reliable daily, weekly, monthly, contract, and supervisor reporting.</p></div>
        <Link href="/upload" className="secondary-button">Start weekly report</Link>
      </header>
      <section className="section-heading"><div><p className="eyebrow">Reporting center</p><h2>What do you need to review?</h2></div></section>
      <section className="feature-grid">
        {areas.map((area) => (
          <article className="feature-card" key={area.title}><div className="feature-mark" /><h3>{area.title}</h3><p>{area.text}</p><Link href={area.href}>{area.action} <span aria-hidden="true">→</span></Link></article>
        ))}
      </section>
      <section className="workflow-card"><div><p className="eyebrow">Designed for your weekly process</p><h2>One source of truth for every operating date</h2></div><ol><li><strong>1</strong><span>Upload the source report</span></li><li><strong>2</strong><span>Review assignments and totals</span></li><li><strong>3</strong><span>Copy the email and preserve history</span></li></ol></section>
    </main>
  );
}
