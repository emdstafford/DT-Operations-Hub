"use client";

import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

const REPORTS: Record<string, { title: string; description: string; filters: string[] }> = {
  "usps-completion": { title: "USPS Completion Report", description: "Supervisor and contract completion performance.", filters: ["dates", "supervisor", "contract"] },
  "driver-contract-supervisor": { title: "Driver / Contract / Supervisor", description: "Driver assignments by contract and supervisor.", filters: ["date", "supervisor", "contract", "driver"] },
  "load-reconciliation": { title: "Load Reconciliation", description: "CLEAR and FourKites matching, extras, cancellations, and unmatched loads.", filters: ["dates", "contract", "status"] },
  "completion-totals": { title: "Completion Totals", description: "Completion totals across the operation.", filters: ["dates", "supervisor", "contract"] },
  "geofence": { title: "Geofence / Missed Stops", description: "Missed-stop and location-level exceptions.", filters: ["dates", "supervisor", "contract"] },
  "monthly-reconciliation": { title: "Monthly Reconciliation", description: "CLEAR actuals, rates, approvals, and monthly reconciliation.", filters: ["month", "contract"] },
  "contract-summary": { title: "Contract Report", description: "Contract-at-a-glance reporting.", filters: ["month", "contract"] },
  "company-fuel": { title: "Company Fuel Report", description: "Monthly company fuel activity.", filters: ["month", "contract"] },
  "driver-fuel": { title: "Driver Fuel Report", description: "Driver diesel, gas, misc, and transaction totals.", filters: ["month", "driver", "contract"] },
  "fuel-comparison": { title: "Fuel Month Comparison", description: "Compare fuel activity between two months.", filters: ["compareMonths", "driver", "contract"] },
  "payroll": { title: "Payroll Report", description: "Payroll reporting by selected period.", filters: ["dates", "contract", "driver"] },
  "timecard-comparison": { title: "Timecard Comparison", description: "Compare payroll periods.", filters: ["compareDates", "contract", "driver"] },
  "contract-payroll-hours": { title: "Contract Payroll Hours", description: "Payroll hours by contract and period.", filters: ["dates", "contract"] },
};

const fieldStyle = { display: "grid", gap: 5, minWidth: 190 } as const;
const inputStyle = { padding: "9px 10px", border: "1px solid #b8c5d3", borderRadius: 8, background: "white" } as const;

export default function ReportLauncherPage() {
  const params = useParams<{ report: string }>();
  const router = useRouter();
  const config = REPORTS[String(params.report)] || { title: "Report", description: "Select filters and generate the report.", filters: ["dates"] };
  const [generated, setGenerated] = useState(false);
  const [values, setValues] = useState<Record<string,string>>({});
  const set = (key:string, value:string) => setValues(v => ({ ...v, [key]: value }));

  const fields = useMemo(() => config.filters.flatMap(filter => {
    if (filter === "dates") return [<label key="start" style={fieldStyle}>Start date<input style={inputStyle} type="date" value={values.start||""} onChange={e=>set("start",e.target.value)} /></label>, <label key="end" style={fieldStyle}>End date<input style={inputStyle} type="date" value={values.end||""} onChange={e=>set("end",e.target.value)} /></label>];
    if (filter === "date") return [<label key="date" style={fieldStyle}>Effective date<input style={inputStyle} type="date" value={values.date||""} onChange={e=>set("date",e.target.value)} /></label>];
    if (filter === "month") return [<label key="month" style={fieldStyle}>Month<input style={inputStyle} type="month" value={values.month||""} onChange={e=>set("month",e.target.value)} /></label>];
    if (filter === "compareMonths") return [<label key="month1" style={fieldStyle}>First month<input style={inputStyle} type="month" value={values.month1||""} onChange={e=>set("month1",e.target.value)} /></label>, <label key="month2" style={fieldStyle}>Compare month<input style={inputStyle} type="month" value={values.month2||""} onChange={e=>set("month2",e.target.value)} /></label>];
    if (filter === "compareDates") return [<label key="period1" style={fieldStyle}>First pay period<input style={inputStyle} type="text" placeholder="Select pay period" value={values.period1||""} onChange={e=>set("period1",e.target.value)} /></label>, <label key="period2" style={fieldStyle}>Compare pay period<input style={inputStyle} type="text" placeholder="Select pay period" value={values.period2||""} onChange={e=>set("period2",e.target.value)} /></label>];
    const label = filter === "driver" ? "Driver" : filter === "supervisor" ? "Supervisor" : filter === "contract" ? "Contract" : "Status";
    return [<label key={filter} style={fieldStyle}>{label}<select style={inputStyle} value={values[filter]||"all"} onChange={e=>set(filter,e.target.value)}><option value="all">All {label.toLowerCase()}s</option></select></label>];
  }), [config.filters, values]);

  return <main className="page-shell">
    <div className="no-print" style={{ marginBottom: 14 }}><button onClick={() => router.push("/reports")} style={{ border: 0, background: "transparent", color: "#123b61", fontWeight: 800, cursor: "pointer" }}>← Reports Center</button></div>
    <header className="page-intro"><div><p className="eyebrow">Report</p><h1>{config.title}</h1><p>{config.description}</p></div></header>

    <section className="no-print" style={{ background: "white", border: "1px solid #d7e0ea", borderRadius: 14, padding: 18, marginBottom: 18 }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 18, color: "#0f2747" }}>Report filters</h2>
      <p style={{ margin: "0 0 14px", color: "#607286", fontSize: 13 }}>Choose what you want included, then generate the printable report.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>{fields}
        <button onClick={() => setGenerated(true)} style={{ padding: "10px 16px", border: 0, borderRadius: 8, background: "#123b61", color: "white", fontWeight: 800, cursor: "pointer" }}>Generate Report</button>
      </div>
    </section>

    {generated && <section style={{ background: "white", border: "1px solid #d7e0ea", borderRadius: 14, padding: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "start", borderBottom: "2px solid #17375e", paddingBottom: 12 }}>
        <div><div style={{ fontWeight: 900, color: "#0f2747", fontSize: 22 }}>Davenport Transportation</div><h2 style={{ margin: "4px 0 0", fontSize: 19 }}>{config.title}</h2></div>
        <button className="no-print" onClick={() => window.print()} style={{ padding: "9px 15px", borderRadius: 8, border: 0, background: "#17375e", color: "white", fontWeight: 800, cursor: "pointer" }}>Print / Save PDF</button>
      </div>
      <div style={{ padding: "18px 0", color: "#607286" }}><strong>Filters:</strong> {Object.entries(values).filter(([,v])=>v).map(([k,v])=>`${k}: ${v}`).join(" · ") || "All available records"}</div>
      <div style={{ padding: 28, textAlign: "center", background: "#f6f8fa", borderRadius: 10, color: "#52677f" }}>Report data will render here using the existing {config.title} data source. The filter-and-print shell is ready.</div>
    </section>}
  </main>;
}
