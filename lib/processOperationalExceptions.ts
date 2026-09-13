import * as XLSX from "xlsx";

export type MissedStopRow = {
  loadNumber: string;
  operatingDate: string;
  contract: string;
  trip: string;
  status: string;
  totalStops: number;
  geofenceStops: number;
  missingStops: number;
  missingLocations: string;
  geofenceNonCompliant: boolean;
  pingNonCompliant: boolean;
};

export type MissedStopSummary = {
  rows: MissedStopRow[];
  duplicateLoadNumbers: string[];
  totalMissingStops: number;
  geofenceNonCompliantLoads: number;
  pingNonCompliantLoads: number;
  unmappedLoads: number;
  byDate: Array<{ key: string; loads: number; missingStops: number }>;
  byContract: Array<{ key: string; loads: number; missingStops: number }>;
  byLocation: Array<{ key: string; occurrences: number }>;
};

function isTrue(value: unknown) {
  return value === true || value === 1 || String(value).toLowerCase() === "true";
}

export async function processOperationalExceptions(file: File): Promise<MissedStopSummary> {
  const workbook = XLSX.read(await file.arrayBuffer());
  const sheet = workbook.Sheets["Non-Compliant Loads"];
  if (!sheet) throw new Error('This workbook does not contain a "Non-Compliant Loads" sheet.');

  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const seen = new Set<string>();
  const duplicateLoadNumbers: string[] = [];
  const rows: MissedStopRow[] = [];

  raw.forEach((row) => {
    const loadNumber = String(row["Load Number"] ?? "").trim();
    if (!loadNumber) return;
    if (seen.has(loadNumber)) {
      duplicateLoadNumbers.push(loadNumber);
      return;
    }
    seen.add(loadNumber);
    const appointment = String(row["First Stop Appointment Time(CDT)"] ?? "");
    rows.push({
      loadNumber,
      operatingDate: appointment.slice(0, 10),
      contract: String(row.Contract ?? "").trim() || "Unmapped",
      trip: String(row["Contract Trip"] ?? "").replace(/^LDT-[A-Z0-9]+-/i, ""),
      status: String(row.Status ?? ""),
      totalStops: Number(row["Total Stops"] || 0),
      geofenceStops: Number(row["Total Geofence Triggered"] || 0),
      missingStops: Number(row["Stops Without Geofence Checkin"] || 0),
      missingLocations: String(row["Stops Missing Geofence"] ?? ""),
      geofenceNonCompliant: isTrue(row["Geofence Non compliance"]),
      pingNonCompliant: isTrue(row["Ping frequency Non compliance"]),
    });
  });

  const summarize = (keyFor: (row: MissedStopRow) => string) => {
    const groups = new Map<string, { loads: number; missingStops: number }>();
    rows.forEach((row) => {
      const key = keyFor(row) || "Unmapped";
      const group = groups.get(key) ?? { loads: 0, missingStops: 0 };
      group.loads += 1;
      group.missingStops += row.missingStops;
      groups.set(key, group);
    });
    return Array.from(groups.entries()).map(([key, value]) => ({ key, ...value }));
  };

  const locations = new Map<string, number>();
  rows.forEach((row) => {
    row.missingLocations.split(",").map((value) => value.trim()).filter(Boolean).forEach((location) => {
      locations.set(location, (locations.get(location) ?? 0) + 1);
    });
  });

  return {
    rows,
    duplicateLoadNumbers: Array.from(new Set(duplicateLoadNumbers)),
    totalMissingStops: rows.reduce((sum, row) => sum + row.missingStops, 0),
    geofenceNonCompliantLoads: rows.filter((row) => row.geofenceNonCompliant).length,
    pingNonCompliantLoads: rows.filter((row) => row.pingNonCompliant).length,
    unmappedLoads: rows.filter((row) => row.contract === "Unmapped" || row.contract === "Others").length,
    byDate: summarize((row) => row.operatingDate).sort((a, b) => a.key.localeCompare(b.key)),
    byContract: summarize((row) => row.contract).sort((a, b) => b.missingStops - a.missingStops),
    byLocation: Array.from(locations.entries())
      .map(([key, occurrences]) => ({ key, occurrences }))
      .sort((a, b) => b.occurrences - a.occurrences),
  };
}
