import Image from "next/image";
import Link from "next/link";

const links = [
  ["Dashboard", "/"],
  ["Upload", "/upload"],
  ["History", "/history"],
  ["Completion", "/completion-totals"],
  ["Supervisors", "/supervisors"],
  ["Contracts", "/contracts"],
];

export default function NavBar() {
  return (
    <header className="site-header">
      <div className="brand-row">
        <Link href="/" className="brand">
          <Image src="/logo.png" alt="Davenport Transportation" width={68} height={68} priority />
          <div><strong>DT Operations Hub</strong><span>Performance intelligence</span></div>
        </Link>
        <div className="header-status"><span className="status-dot" />Operations reporting</div>
      </div>
      <nav className="main-nav" aria-label="Primary navigation">
        {links.map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}
      </nav>
    </header>
  );
}
