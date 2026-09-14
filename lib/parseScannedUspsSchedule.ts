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

function improveScannedText(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const values = new Uint8Array(image.data.length / 4);
  const histogram = new Uint32Array(256);

  for (let pixel = 0, index = 0; pixel < image.data.length; pixel += 4, index += 1) {
    const gray = Math.round(image.data[pixel] * 0.299 + image.data[pixel + 1] * 0.587 + image.data[pixel + 2] * 0.114);
    values[index] = gray;
    histogram[gray] += 1;
  }

  const total = values.length;
  let totalIntensity = 0;
  for (let value = 0; value < 256; value += 1) totalIntensity += value * histogram[value];

  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let threshold = 180;
  for (let value = 0; value < 256; value += 1) {
    backgroundWeight += histogram[value];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += value * histogram[value];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (totalIntensity - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = value;
    }
  }

  // A small lift keeps faint type while removing gray scan noise.
  const adjustedThreshold = Math.min(220, threshold + 18);
  for (let pixel = 0, index = 0; pixel < image.data.length; pixel += 4, index += 1) {
    const output = values[index] < adjustedThreshold ? 0 : 255;
    image.data[pixel] = output;
    image.data[pixel + 1] = output;
    image.data[pixel + 2] = output;
    image.data[pixel + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

export async function parseScannedUspsSchedule(
  file: File,
  firstPage: number,
  lastPage: number,
  onProgress?: (progress: OcrProgress) => void,
): Promise<OcrScheduleAnalysis> {
  const pdfjs = await import("pdfjs-dist");
  const { createWorker, PSM } = await import("tesseract.js");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const pdfDocument = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  if (!Number.isInteger(firstPage) || !Number.isInteger(lastPage) || firstPage < 1 || lastPage < firstPage || lastPage > pdfDocument.numPages) {
    throw new Error(`Choose a page range between 1 and ${pdfDocument.numPages}.`);
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
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.AUTO,
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });

  const pages: string[] = [];
  const confidences: number[] = [];
  try {
    for (let pageNumber = firstPage; pageNumber <= lastPage; pageNumber += 1) {
      activePage = pageNumber;
      onProgress?.({ page: pageNumber, totalPages: lastPage - firstPage + 1, status: "Preparing a high-resolution page", progress: 0 });
      const page = await pdfDocument.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 3 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error(`Page ${pageNumber} could not be prepared for OCR.`);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      improveScannedText(canvas);
      const result = await worker.recognize(canvas);
      pages.push(`--- PDF PAGE ${pageNumber} ---\n${result.data.text}`);
      confidences.push(result.data.confidence);
    }
  } finally {
    await worker.terminate();
  }

  const extractedText = pages.join("\n");
  const summary = analyzeScheduleText(extractedText, pdfDocument.numPages, file.name);
  const averageConfidence = confidences.length
    ? confidences.reduce((total, value) => total + value, 0) / confidences.length
    : 0;
  const lowConfidence = averageConfidence < 85;
  const warnings = [...summary.warnings];
  if (lowConfidence) warnings.unshift(`OCR confidence is ${averageConfidence.toFixed(1)}%. Comparison results are withheld until the scan can be read reliably.`);
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
