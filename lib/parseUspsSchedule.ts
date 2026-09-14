type TextItem = { str?: string; transform?: number[] };

export type ScheduleAnalysis = {
  pageCount: number;
  contractNumber: string;
  tripIds: string[];
  frequencyCodes: Array<{ code: string; days: string; description: string }>;
  effectiveDates: string[];
  annualMiles: number | null;
  annualHours: number | null;
  changeSummaryFound: boolean;
  warnings: string[];
};

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

export async function parseUspsSchedule(file: File): Promise<ScheduleAnalysis> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = typeof window === "undefined"
    ? new URL("../node_modules/pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()
    : "/pdf.worker.min.mjs";
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    lines.push(...pageLines(content.items as TextItem[]));
  }
  const text = lines.join("\n");
  const headerContract = text.match(/\bHCR(?:#|\s+ID)?[\s\S]{0,120}?\b(\d{4}[A-Z])\b/i)?.[1];
  const filenameContract = file.name?.match(/\b(\d{4}[A-Z])\b/i)?.[1];
  const contractNumber = (headerContract || filenameContract || "").toUpperCase();
  const tripIds = new Set<string>();
  for (const line of lines) {
    const match = line.match(/^\s*(\d{1,3})\s+(\d{1,2})\s+\d{3,6}\b/);
    if (match) tripIds.add(match[1]);
  }
  const frequencyCodes: ScheduleAnalysis["frequencyCodes"] = [];
  for (const line of lines) {
    const match = line.match(/^\s*([A-Z0-9]{1,4})\s*-\s*(\d+)\s+(.+)$/i);
    if (match && /daily|sunday|monday|tuesday|wednesday|thursday|friday|saturday|holiday/i.test(match[3])) {
      frequencyCodes.push({ code: match[1].toUpperCase(), days: match[2], description: match[3].trim() });
    }
  }
  const effectiveDates = [...new Set(text.match(/\b\d{2}\/\d{2}\/20\d{2}\b/g) || [])].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const annualMilesMatch = text.match(/Estimated Annual Schedule Miles\s*:?\s*([\d,]+(?:\.\d+)?)/i);
  const annualHoursMatch = text.match(/Estimated Annual Schedule Hours\s*:?\s*([\d,]+(?:\.\d+)?)/i);
  const warnings: string[] = [];
  if (!contractNumber) warnings.push("Contract number was not confidently identified.");
  if (!tripIds.size) warnings.push("No trip rows were confidently identified.");
  if (!frequencyCodes.length) warnings.push("Frequency reference definitions were not found; do not approve this schedule.");
  if (!effectiveDates.length) warnings.push("No effective dates were found.");
  return {
    pageCount: document.numPages,
    contractNumber,
    tripIds: [...tripIds].sort((a, b) => Number(a) - Number(b)),
    frequencyCodes,
    effectiveDates,
    annualMiles: annualMilesMatch ? Number(annualMilesMatch[1].replaceAll(",", "")) : null,
    annualHours: annualHoursMatch ? Number(annualHoursMatch[1].replaceAll(",", "")) : null,
    changeSummaryFound: /Trip Change Summary/i.test(text),
    warnings,
  };
}
