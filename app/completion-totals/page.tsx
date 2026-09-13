import CompletionExplorer from "@/components/CompletionExplorer";

export default function Page() {
  return <main className="page-shell">
    <header className="page-intro"><div>
      <p className="eyebrow">Shared USPS history</p>
      <h1>Completion performance</h1>
      <p>View company performance or select a supervisor to see only the contracts assigned to them during that period.</p>
    </div></header>
    <CompletionExplorer />
  </main>;
}
