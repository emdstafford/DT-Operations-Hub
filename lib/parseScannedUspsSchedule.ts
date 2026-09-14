import { analyzeScheduleText, type ScheduleAnalysis } from "@/lib/parseUspsSchedule";

export type OcrScheduleAnalysis = ScheduleAnalysis & {
  averageConfidence: number;
  pagesProcessed: number[];
  extractedText: string;
  lowConfidence: boolean;
};

export type OcrProgress = {
  page: number;
  totalPages: number;
  status: string;
  progress: number;
};

export async function parseScannedUspsSchedule(
  file: File,
  firstPage: number,
  lastPage: number,
  onProgress?: (progress: OcrProgress) => void,
): Promise<OcrScheduleAnalysis> {
  const pdfjs = await import("pdfjs-dist");
  const { createWorker } = await import("tesseract.js");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  if (!Number.isInteger(firstPage) || !Number.isInteger(lastPage) || firstPage < 1 || lastPage < firstPage || lastPage > document.numPages) {
    throw new Error(`Choose a page range between 1 and ${document.numPages}.`);
  }

  let activePage = firstPage;
  const worker = await createWorker("eng", undefined, {
    logger(message) {
      onProgress?.({
        page: activePage,
        totalPages: lastPage - firstPage + 1,
        status: message.status || "Reading page",
        progress: Number(message.progress || 0),
      });
    },
  });

  const pages: string[] = [];
  const confidences: number[] = [];
  try {
    for (let pageNumber = firstPage; pageNumber <= lastPage; pageNumber += 1) {
      activePage = pageNumber;
      onProgress?.({ page: pageNumber, totalPages: lastPage - firstPage + 1, status: "Rendering page", progress: 0 });
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error(`Page ${pageNumber} could not be prepared for OCR.`);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      const result = await worker.recognize(canvas);
      pages.push(`--- PDF PAGE ${pageNumber} ---\n${result.data.text}`);
      confidences.push(result.data.confidence);
    }
  } finally {
    await worker.terminate();
  }

  const extractedText = pages.join("\n");
  const summary = analyzeScheduleText(extractedText, document.numPages, file.name);
  const averageConfidence = confidences.length
    ? confidences.reduce((total, value) => total + value, 0) / confidences.length
    : 0;
  const lowConfidence = averageConfidence < 85;
  const warnings = [...summary.warnings];
  if (lowConfidence) warnings.unshift(`OCR confidence is ${averageConfidence.toFixed(1)}%. Verify every time, NASS code, address, frequency, and vehicle requirement against the PDF.`);
  warnings.push("OCR results are a draft. A DT reviewer must verify the source pages before approval.");

  return {
    ...summary,
    warnings,
    averageConfidence,
    pagesProcessed: Array.from({ length: lastPage - firstPage + 1 }, (_, index) => firstPage + index),
    extractedText,
    lowConfidence,
  };
}
