type TextItem = { str?: string; transform?: number[] };

export type ScheduleAnalysis = {
  pageCount: number;
  contractNumber: string;
  tripIds: string[];
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
    // The total appears near the top of a schedule, above the trip rows.
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

export function analyzeScheduleText(text: string, pageCount: number, fileName = ""): ScheduleAnalysis {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const headerContract = text.match(/\bHCR(?:#|\s+ID)?[\s\S]{0,120}?\b(\d{4}[A-Z])\b/i)?.[1];
  const filenameContract = fileName.match(/\b(\d{4}[A-Z])\b/i)?.[1];
  const contractNumber = (headerContract || filenameContract || "").toUpperCase();
  const tripIds = new Set<string>();
  for (const line of lines) {
    const match = line.match(/^\s*(\d{1,3})\s+(\d{1,2})\s+\d{3,6}\b/);
    if (match) tripIds.add(match[1]);
  }
  const frequencyCodes: ScheduleAnalysis["frequencyCodes"] = [];
  const seenFrequencies = new Set<string>();
  for (const line of lines) {
    const match = line.match(/^\s*([A-Z0-9]{1,4})\s*-\s*(\d+)\s+(.+)$/i);
    if (match && /daily|sunday|monday|tuesday|wednesday|thursday|friday|saturday|holiday/i.test(match[3])) {
      const code = match[1].toUpperCase();
      if (!seenFrequencies.has(code)) {
        seenFrequencies.add(code);
        frequencyCodes.push({ code, days: match[2], description: match[3].trim() });
      }
    }
  }
  const effectiveDates = [...new Set(text.match(/\b\d{2}\/\d{2}\/20\d{2}\b/g) || [])].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const miles = statedAnnualTotal(text, "miles");
  const hours = statedAnnualTotal(text, "hours");
  const warnings: string[] = [];
  if (!contractNumber) warnings.push("Contract number was not confidently identified.");
  if (!tripIds.size) warnings.push("No trip rows were confidently identified.");
  if (!frequencyCodes.length) warnings.push("Frequency reference definitions were not found; do not approve this schedule.");
  if (!effectiveDates.length) warnings.push("No effective dates were found.");
  if (miles.conflict) warnings.push("Different annual miles are stated in this PDF. Check the source pages; no miles total was selected.");
  if (hours.conflict) warnings.push("Different annual hours are stated in this PDF. Check the source pages; no hours total was selected.");
  if (!miles.value && !miles.conflict) warnings.push("No labeled annual miles total was found near the top of a schedule page.");
  return {
    pageCount,
    contractNumber,
    tripIds: [...tripIds].sort((a, b) => Number(a) - Number(b)),
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
