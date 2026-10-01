type TextItem = { str?: string; transform?: number[] };

export type ScheduleTrip = {
  tripNumber: string;
  vehicleType: string | null;
  frequencyCode: string | null;
  frequencyDays: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  tripMiles: number | null;
  tripHours: number | null;
};

export type ScheduleAnalysis = {
  pageCount: number;
  contractNumber: string;
  tripIds: string[];
  trips: ScheduleTrip[];
  frequencyCodes: Array<{ code: string; days: string; description: string }>;
  effectiveDates: string[];
  annualMiles: number | null;
  annualHours: number | null;
  annualMilesPage: number | null;
  annualHoursPage: number | null;
  changeSummaryFound: boolean;
  warnings: string[];
};

type StatedTotal = { value: number | null; page: number | null; conflict: boolean };

function isoDate(value: string | undefined) {
  if (!value) return null;
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : null;
}

// Only an explicitly labeled annual total is a contract total. Trip miles and
// frequency-day counts must never be substituted for it.
function statedAnnualTotal(text: string, unit: "miles" | "hours"): StatedTotal {
  const pages = text.split(/--- PDF PAGE (\d+) ---/i);
  const chunks = pages.length > 1
    ? Array.from({ length: (pages.length - 1) / 2 }, (_, index) => ({ page: Number(pages[index * 2 + 1]), text: pages[index * 2 + 2] }))
    : [{ page: 1, text }];
  const values: Array<{ value: number; page: number }> = [];
  const label = new RegExp(`\\b(?:Estimated\\s+)?Annual\\s+(?:Schedule\\s+)?${unit}\\s*:?\\s*([\\d,]+(?:\\.\\d+)?)\\b`, "gi");
  for (const chunk of chunks) {
    const top = chunk.text.split(/\r?\n/).slice(0, 45).join("\n");
    for (const match of top.matchAll(label)) {
      const value = Number(match[1].replaceAll(",", ""));
      if (Number.isFinite(value) && value > 0) values.push({ value, page: chunk.page });
    }
  }
  const unique = new Set(values.map(({ value }) => value));
  return { value: unique.size === 1 ? values[0].value : null, page: unique.size === 1 ? values[0].page : null, conflict: unique.size > 1 };
}

function pageLines(items: TextItem[]) {
  const rows = new Map<number, Array<{ x: number; text: string }>>();
  for (const item of items) {
    const text = item.str?.trim();
    const transform = item.transform;
    if (!text || !transform) continue;
    const y = Math.round(transform[5] / 2) * 2;
    const row = rows.get(y) || [];
    row.push({ x: transform[4], text });
    rows.set(y, row);
  }
  return [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, row]) => row.sort((a, b) => a.x - b.x).map((part) => part.text).join(" "));
}

function parseTripRows(lines: string[]): ScheduleTrip[] {
  const trips = new Map<string, ScheduleTrip>();
  let activeTrip = "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    // First stop row contains the per-trip vehicle/frequency/effective-date fields.
    const firstStop = line.match(/^\s*(\d{1,4})\s+1\s+\S+\s+.+?\s+(\S+)\s+([A-Z0-9]{1,5})\s+([\d.]+)\s+(\d{2}\/\d{2}\/20\d{2})\s+(\d{2}\/\d{2}\/20\d{2})\s*$/i);
    if (firstStop) {
      activeTrip = String(Number(firstStop[1]));
      trips.set(activeTrip, {
        tripNumber: activeTrip,
        vehicleType: firstStop[2] || null,
        frequencyCode: firstStop[3]?.toUpperCase() || null,
        frequencyDays: Number.isFinite(Number(firstStop[4])) ? Number(firstStop[4]) : null,
        effectiveFrom: isoDate(firstStop[5]),
        effectiveTo: isoDate(firstStop[6]),
        tripMiles: null,
        tripHours: null,
      });
      continue;
    }

    if (/^Trip\s+Miles\s+Trip\s+Hrs/i.test(line) && activeTrip) {
      for (let look = index + 1; look <= Math.min(index + 3, lines.length - 1); look += 1) {
        const totals = lines[look].match(/^\s*([\d,.]+)\s+([\d,.]+)(?:\s+[\d,.]+)?\s*$/);
        if (!totals) continue;
        const current = trips.get(activeTrip);
        if (current) {
          current.tripMiles = Number(totals[1].replaceAll(",", ""));
          current.tripHours = Number(totals[2].replaceAll(",", ""));
          trips.set(activeTrip, current);
        }
        break;
      }
    }
  }

  return [...trips.values()].sort((a, b) => Number(a.tripNumber) - Number(b.tripNumber));
}

export function analyzeScheduleText(text: string, pageCount: number, fileName = ""): ScheduleAnalysis {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const contractPattern = "(\\d{4}[A-Z]|\\d{3}[A-Z]\\d|\\d{2}[A-Z]\\d{2})";
  const headerContract = text.match(new RegExp(`\\bHCR(?:#|\\s+ID)?[\\s\\S]{0,120}?\\b${contractPattern}\\b`, "i"))?.[1];
  const filenameContract = fileName.match(new RegExp(`\\b${contractPattern}\\b`, "i"))?.[1];
  const contractNumber = (headerContract || filenameContract || "").toUpperCase();

  const parsedTrips = parseTripRows(lines);
  const tripIds = parsedTrips.length
    ? parsedTrips.map((trip) => trip.tripNumber)
    : [...new Set(lines.flatMap((line) => {
        const match = line.match(/^\s*(\d{1,4})\s+(\d{1,2})\s+\d{3,6}\b/);
        return match ? [String(Number(match[1]))] : [];
      }))].sort((a, b) => Number(a) - Number(b));

  const frequencyCodes: ScheduleAnalysis["frequencyCodes"] = [];
  const seenFrequencies = new Set<string>();
  for (const line of lines) {
    const match = line.match(/^\s*([A-Z0-9]{1,5})\s*-\s*(\d+)\s+(.+)$/i);
    if (match && /daily|sunday|monday|tuesday|wednesday|thursday|friday|saturday|holiday/i.test(match[3])) {
      const code = match[1].toUpperCase();
      if (!seenFrequencies.has(code)) {
        seenFrequencies.add(code);
        frequencyCodes.push({ code, days: match[2], description: match[3].trim() });
      }
    }
  }

  const effectiveDates = [...new Set((parsedTrips.length
    ? parsedTrips.flatMap((trip) => [trip.effectiveFrom, trip.effectiveTo].filter(Boolean) as string[])
    : (text.match(/\b\d{2}\/\d{2}\/20\d{2}\b/g) || []).map((value) => isoDate(value)!).filter(Boolean)
  ))].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  const miles = statedAnnualTotal(text, "miles");
  const hours = statedAnnualTotal(text, "hours");
  const warnings: string[] = [];
  if (!contractNumber) warnings.push("Contract number was not confidently identified.");
  if (!tripIds.length) warnings.push("No trip rows were confidently identified.");
  if (parsedTrips.length && parsedTrips.some((trip) => trip.tripMiles == null || trip.tripHours == null)) warnings.push("Some trips were found but their trip miles/hours could not be confidently paired. Review before saving.");
  if (!frequencyCodes.length) warnings.push("Frequency reference definitions were not found; do not approve this schedule.");
  if (!effectiveDates.length) warnings.push("No effective dates were found.");
  if (miles.conflict) warnings.push("Different annual miles are stated in this PDF. Check the source pages; no miles total was selected.");
  if (hours.conflict) warnings.push("Different annual hours are stated in this PDF. Check the source pages; no hours total was selected.");
  if (!miles.value && !miles.conflict) warnings.push("No labeled annual miles total was found near the top of a schedule page.");

  return {
    pageCount,
    contractNumber,
    tripIds,
    trips: parsedTrips,
    frequencyCodes,
    effectiveDates,
    annualMiles: miles.value,
    annualHours: hours.value,
    annualMilesPage: miles.page,
    annualHoursPage: hours.page,
    changeSummaryFound: /Trip Change Summary/i.test(text),
    warnings,
  };
}

export async function parseUspsSchedule(file: File): Promise<ScheduleAnalysis> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    lines.push(`--- PDF PAGE ${pageNumber} ---`, ...pageLines(content.items as TextItem[]));
  }
  return analyzeScheduleText(lines.join("\n"), document.numPages, file.name);
}
