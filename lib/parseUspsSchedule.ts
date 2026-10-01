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
  stopCount: number;
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
  sourceMode?: "text" | "ocr";
};

type StatedTotal = { value: number | null; page: number | null; conflict: boolean };

function isoDate(value: string | undefined) {
  if (!value) return null;
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : null;
}

function cleanPdfLine(value: string) {
  return value.replace(/\bLOGISTICS\s+APPROVED\b/gi, " ").replace(/\s+/g, " ").trim();
}

function statedAnnualTotal(text: string, unit: "miles" | "hours"): StatedTotal {
  const pages = text.split(/--- PDF PAGE (\d+) ---/i);
  const chunks = pages.length > 1 ? Array.from({ length: (pages.length - 1) / 2 }, (_, index) => ({ page: Number(pages[index * 2 + 1]), text: pages[index * 2 + 2] })) : [{ page: 1, text }];
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
    const text = item.str?.trim(); const transform = item.transform;
    if (!text || !transform) continue;
    const y = Math.round(transform[5] / 2) * 2;
    const row = rows.get(y) || []; row.push({ x: transform[4], text }); rows.set(y, row);
  }
  return [...rows.entries()].sort((a,b)=>b[0]-a[0]).map(([,row])=>cleanPdfLine(row.sort((a,b)=>a.x-b.x).map(part=>part.text).join(" "))).filter(Boolean);
}

function parseTripRows(lines: string[]): ScheduleTrip[] {
  const trips = new Map<string, ScheduleTrip>(); let activeTrip = ""; let awaitingTotalsFor = "";
  for (const raw of lines) {
    const line = cleanPdfLine(raw); if (!line) continue;
    if (/^--- PDF PAGE \d+ ---$/i.test(line) || /^Trip\s+ID\b/i.test(line) || /^Stop\s*#\b/i.test(line) || /^(Nass Code|Facility|Arrive Time|Load\/|Unload|Depart Time|Vehicle|Freq|Freq Days|Eff\. Date|Exp\. Date)/i.test(line)) continue;
    const firstStop = line.match(/^\s*(\d{1,4})\s+1\s+\S+\s+.+?\s+(\S+)\s+([A-Z0-9]{1,5})\s+([\d.]+)\s+(\d{2}\/\d{2}\/20\d{2})\s+(\d{2}\/\d{2}\/20\d{2})\s*$/i);
    if (firstStop) {
      activeTrip=String(Number(firstStop[1])); awaitingTotalsFor="";
      trips.set(activeTrip,{tripNumber:activeTrip,vehicleType:firstStop[2]||null,frequencyCode:firstStop[3]?.toUpperCase()||null,frequencyDays:Number.isFinite(Number(firstStop[4]))?Number(firstStop[4]):null,effectiveFrom:isoDate(firstStop[5]),effectiveTo:isoDate(firstStop[6]),tripMiles:null,tripHours:null,stopCount:1}); continue;
    }
    const stopRow=line.match(/^\s*(\d{1,4})\s+(\d{1,2})\s+\S+\b/);
    if(stopRow){const tripNumber=String(Number(stopRow[1]));const stopNumber=Number(stopRow[2]);const current=trips.get(tripNumber);if(current&&Number.isFinite(stopNumber)){current.stopCount=Math.max(current.stopCount||0,stopNumber);trips.set(tripNumber,current);activeTrip=tripNumber;}}
    if(/^Trip\s+Miles\s+Trip\s+Hrs/i.test(line)&&activeTrip){awaitingTotalsFor=activeTrip;continue;}
    if(awaitingTotalsFor){const totals=line.match(/^\s*([\d,.]+)\s+([\d,.]+)/);if(totals){const current=trips.get(awaitingTotalsFor);if(current){current.tripMiles=Number(totals[1].replaceAll(",",""));current.tripHours=Number(totals[2].replaceAll(",",""));trips.set(awaitingTotalsFor,current);}awaitingTotalsFor="";}}
  }
  return [...trips.values()].sort((a,b)=>Number(a.tripNumber)-Number(b.tripNumber));
}

export function analyzeScheduleText(text:string,pageCount:number,fileName=""):ScheduleAnalysis{
  const cleanedText=text.split(/\r?\n/).map(cleanPdfLine).filter(Boolean).join("\n");const lines=cleanedText.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const contractPattern="(\\d{4}[A-Z]|\\d{3}[A-Z]\\d|\\d{2}[A-Z]\\d{2})";const headerContract=cleanedText.match(new RegExp(`\\bHCR(?:#|\\s+ID)?[\\s\\S]{0,120}?\\b${contractPattern}\\b`,"i"))?.[1];const filenameContract=fileName.match(new RegExp(`\\b${contractPattern}\\b`,"i"))?.[1];const contractNumber=(headerContract||filenameContract||"").toUpperCase();
  const parsedTrips=parseTripRows(lines);const tripIds=parsedTrips.length?parsedTrips.map(t=>t.tripNumber):[...new Set(lines.flatMap(line=>{const m=line.match(/^\s*(\d{1,4})\s+(\d{1,2})\s+\d{3,6}\b/);return m?[String(Number(m[1]))]:[]}))].sort((a,b)=>Number(a)-Number(b));
  const frequencyCodes:ScheduleAnalysis["frequencyCodes"]=[];const seen=new Set<string>();for(const line of lines){const m=line.match(/^\s*([A-Z0-9]{1,5})\s*-\s*(\d+)\s+(.+)$/i);if(m&&/daily|sunday|monday|tuesday|wednesday|thursday|friday|saturday|holiday/i.test(m[3])){const code=m[1].toUpperCase();if(!seen.has(code)){seen.add(code);frequencyCodes.push({code,days:m[2],description:m[3].trim()});}}}
  const effectiveDates=[...new Set((parsedTrips.length?parsedTrips.flatMap(t=>[t.effectiveFrom,t.effectiveTo].filter(Boolean) as string[]):(cleanedText.match(/\b\d{2}\/\d{2}\/20\d{2}\b/g)||[]).map(v=>isoDate(v)!).filter(Boolean)))].sort((a,b)=>new Date(a).getTime()-new Date(b).getTime());
  const miles=statedAnnualTotal(cleanedText,"miles"),hours=statedAnnualTotal(cleanedText,"hours"),warnings:string[]=[];
  if(!contractNumber)warnings.push("Contract number was not confidently identified.");if(!tripIds.length)warnings.push("No trip rows were confidently identified.");if(parsedTrips.length&&parsedTrips.some(t=>t.tripMiles==null||t.tripHours==null))warnings.push("Some trips were found but their trip miles/hours could not be confidently paired. Review before saving.");if(!frequencyCodes.length)warnings.push("Frequency reference definitions were not found; do not approve this schedule.");if(!effectiveDates.length)warnings.push("No effective dates were found.");if(miles.conflict)warnings.push("Different annual miles are stated in this PDF. Check the source pages; no miles total was selected.");if(hours.conflict)warnings.push("Different annual hours are stated in this PDF. Check the source pages; no hours total was selected.");if(!miles.value&&!miles.conflict)warnings.push("No labeled annual miles total was found near the top of a schedule page.");
  return{pageCount,contractNumber,tripIds,trips:parsedTrips,frequencyCodes,effectiveDates,annualMiles:miles.value,annualHours:hours.value,annualMilesPage:miles.page,annualHoursPage:hours.page,changeSummaryFound:/Trip Change Summary/i.test(cleanedText),warnings};
}

async function renderPageForOcr(page:any){
  const viewport=page.getViewport({scale:1.8});const canvas=document.createElement("canvas");canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const context=canvas.getContext("2d");if(!context)throw new Error("Could not create OCR canvas.");await page.render({canvasContext:context,viewport}).promise;return canvas;
}

export async function parseUspsSchedule(file:File):Promise<ScheduleAnalysis>{
  const pdfjs=await import("pdfjs-dist");pdfjs.GlobalWorkerOptions.workerSrc=new URL("pdfjs-dist/build/pdf.worker.min.mjs",import.meta.url).toString();
  const documentPdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;const textLines:string[]=[];let extractedCharacters=0;
  for(let pageNumber=1;pageNumber<=documentPdf.numPages;pageNumber++){const page=await documentPdf.getPage(pageNumber);const content=await page.getTextContent();const lines=pageLines(content.items as TextItem[]);extractedCharacters+=lines.join(" ").length;textLines.push(`--- PDF PAGE ${pageNumber} ---`,...lines);}
  const textAnalysis=analyzeScheduleText(textLines.join("\n"),documentPdf.numPages,file.name);
  const usableText=extractedCharacters>500&&textAnalysis.trips.length>0;
  if(usableText)return{...textAnalysis,sourceMode:"text"};

  // Image/scanned USPS schedules: automatically OCR the pages, then send the
  // recognized text through the exact same review parser. Nothing is auto-saved.
  const {createWorker}=await import("tesseract.js");const worker=await createWorker("eng");const ocrLines:string[]=[];
  try{
    for(let pageNumber=1;pageNumber<=documentPdf.numPages;pageNumber++){
      const page=await documentPdf.getPage(pageNumber);const canvas=await renderPageForOcr(page);const result=await worker.recognize(canvas);ocrLines.push(`--- PDF PAGE ${pageNumber} ---`,...result.data.text.split(/\r?\n/).map(cleanPdfLine).filter(Boolean));
    }
  }finally{await worker.terminate();}
  const ocrAnalysis=analyzeScheduleText(ocrLines.join("\n"),documentPdf.numPages,file.name);
  const warnings=["Scanned/image PDF detected. OCR was used; review all trip values before saving.",...ocrAnalysis.warnings];
  return{...ocrAnalysis,sourceMode:"ocr",warnings};
}
