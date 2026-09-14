"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

type Props = {
  contract: string;
  effectiveDate: string;
  officialTrips: string[];
  simplifiedFile?: File;
  driverFile?: File;
};

type WorkbookTripIndex = {
  trips: Set<string>;
  warnings: string[];
};

type ReconciliationRow = {
  trip: string;
  inSimplified: boolean;
  inDriver: boolean;
};

function normalizedTrip(value: unknown) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,3}$/.test(text)) return "";
  const number = Number(text);
  return number > 0 && number < 200 ? String(number) : "";
}

async function indexWorkbook(file: File, kind: "simplified" | "driver"): Promise<WorkbookTripIndex> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const trips = new Set<string>();
  const warnings: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
    });

    const headerCandidates: Array<{ row: number; column: number }> = [];
    rows.forEach((row, rowIndex) => {
      row.forEach((cell, columnIndex) => {
        const header = String(cell ?? "").trim().replace(/\s+/g, " ");
        if (/^trip\s*(?:#|id|number)?$/i.test(header)) {
          headerCandidates.push({ row: rowIndex, column: columnIndex });
        }
      });
    });

    if (headerCandidates.length) {
      for (const header of headerCandidates) {
        for (let rowIndex = header.row + 1; rowIndex < rows.length; rowIndex += 1) {
          const trip = normalizedTrip(rows[rowIndex]?.[header.column]);
          if (trip) trips.add(trip);
        }
      }
      continue;
    }

    // The known DT driver workbook keeps the trip number in column B.
    // This fallback is intentionally limited to the driver file and rejects
    // values 200+, which are commonly vehicle codes rather than trip IDs.
    if (kind === "driver") {
      for (const row of rows) {
        const trip = normalizedTrip(row[1]);
        if (trip) trips.add(trip);
      }
    }
  }

  if (!trips.size) warnings.push(`No trip-number column was found in ${file.name}.`);
  return { trips, warnings };
}

export default function ScheduleTripReconciliation({
  contract,
  effectiveDate,
  officialTrips,
  simplifiedFile,
  driverFile,
}: Props) {
  const [simplified, setSimplified] = useState<WorkbookTripIndex>({ trips: new Set(), warnings: [] });
  const [driver, setDriver] = useState<WorkbookTripIndex>({ trips: new Set(), warnings: [] });
  const [reviewedTrips, setReviewedTrips] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        const [simplifiedResult, driverResult] = await Promise.all([
          simplifiedFile ? indexWorkbook(simplifiedFile, "simplified") : Promise.resolve({ trips: new Set<string>(), warnings: ["Add the existing simplified schedule."] }),
          driverFile ? indexWorkbook(driverFile, "driver") : Promise.resolve({ trips: new Set<string>(), warnings: ["Add the driver schedule."] }),
        ]);
        if (!cancelled) {
          setSimplified(simplifiedResult);
          setDriver(driverResult);
          setReviewedTrips(new Set());
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => { cancelled = true; };
  }, [simplifiedFile, driverFile]);

  const rows = useMemo<ReconciliationRow[]>(() => officialTrips.map((trip) => ({
    trip,
    inSimplified: simplified.trips.has(trip),
    inDriver: driver.trips.has(trip),
  })), [officialTrips, simplified, driver]);

  const matched = rows.filter((row) => row.inSimplified && row.inDriver).length;
  const needsAttention = rows.length - matched;
  const allReviewed = rows.length > 0 && reviewedTrips.size === rows.length && needsAttention === 0;
  const warnings = [...simplified.warnings, ...driver.warnings];

  function toggleReviewed(trip: string) {
    setReviewedTrips((current) => {
      const next = new Set(current);
      if (next.has(trip)) next.delete(trip);
      else next.add(trip);
      return next;
    });
  }

  if (!officialTrips.length) return null;

  return <section className="panel trip-reconciliation">
    <div className="section-heading">
      <div>
        <p className="eyebrow">Accuracy checkpoint</p>
        <h2>Trip-by-trip reconciliation</h2>
        <p>{contract || "Contract"}{effectiveDate ? ` · Effective ${effectiveDate}` : ""}</p>
      </div>
      <span className={allReviewed ? "review-ready" : "review-waiting"}>
        {allReviewed ? "Trip list reviewed" : "Approval blocked"}
      </span>
    </div>

    <div className="reconciliation-summary">
      <div><span>Official USPS trips</span><strong>{rows.length}</strong></div>
      <div><span>In both DT schedules</span><strong>{matched}</strong></div>
      <div className={needsAttention ? "summary-alert" : ""}><span>Needs attention</span><strong>{needsAttention}</strong></div>
      <div><span>Reviewer checked</span><strong>{reviewedTrips.size}/{rows.length}</strong></div>
    </div>

    {warnings.map((warning) => <p className="analysis-warning" key={warning}>⚠ {warning}</p>)}
    {loading ? <p className="coming-note">Reading the DT workbooks on this device…</p> :
      <div className="reconciliation-table-wrap">
        <table className="reconciliation-table">
          <thead><tr><th>Trip</th><th>Official USPS</th><th>Simplified schedule</th><th>Driver schedule</th><th>Reviewer</th></tr></thead>
          <tbody>{rows.map((row) => {
            const complete = row.inSimplified && row.inDriver;
            return <tr key={row.trip} className={complete ? "" : "reconciliation-row-alert"}>
              <th>{row.trip}</th>
              <td><span className="source-present">Present</span></td>
              <td><span className={row.inSimplified ? "source-present" : "source-missing"}>{row.inSimplified ? "Present" : "Missing"}</span></td>
              <td><span className={row.inDriver ? "source-present" : "source-missing"}>{row.inDriver ? "Present" : "Missing"}</span></td>
              <td><label className="trip-review-check"><input type="checkbox" checked={reviewedTrips.has(row.trip)} onChange={() => toggleReviewed(row.trip)} /><span>{reviewedTrips.has(row.trip) ? "Checked" : "Review"}</span></label></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}

    <p className="approval-blocker">
      <strong>{allReviewed ? "Trip-list checkpoint complete." : "Approval remains blocked."}</strong>{" "}
      {needsAttention
        ? `${needsAttention} official trip${needsAttention === 1 ? "" : "s"} must be located or intentionally excluded before approval.`
        : reviewedTrips.size < rows.length
          ? "An authorized reviewer must check every trip."
          : "The next checkpoint will validate every stop, time, NASS code, frequency, mileage, vehicle requirement, and parking assignment."}
    </p>
  </section>;
}
