import ScheduleBuilder from "@/components/ScheduleBuilder";

export default function ScheduleBuilderPage() {
  return <main className="page-shell schedule-builder-page">
    <header className="hub-header">
      <div>
        <p className="eyebrow">DT Operations Workspace</p>
        <h1>Schedule Builder</h1>
        <p>Turn an official USPS schedule into a reviewed simplified schedule and driver-ready plan while preserving every effective-dated service change.</p>
      </div>
    </header>
    <ScheduleBuilder />
  </main>;
}
