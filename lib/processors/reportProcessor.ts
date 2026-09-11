import * as XLSX from "xlsx";

export async function processReport(file: File) {
  const data = await file.arrayBuffer();

  const workbook = XLSX.read(data);

  const mainSheet = workbook.Sheets["Main"];

  if (!mainSheet) {
    return {
      contracts: [],
    };
  }

  const rows: any[] = XLSX.utils.sheet_to_json(mainSheet);

  const contracts: Record<
    string,
    {
      totalStops: number;
      completedStops: number;
      incompleteStops: number;
    }
  > = {};

  rows.forEach((row) => {
    const tags = String(row["Tags"] || "");

    const matches = tags.match(/\b\d{4}[A-Z]\b/g);

    if (!matches) return;

    matches.forEach((contract) => {
      if (!contracts[contract]) {
        contracts[contract] = {
          totalStops: 0,
          completedStops: 0,
          incompleteStops: 0,
        };
      }

      contracts[contract].totalStops += Number(
        row["Stops Count"] || 0
      );

      contracts[contract].completedStops += Number(
        row["Stops With Timestamp"] || 0
      );

      contracts[contract].incompleteStops += Number(
        row["Incomplete Stops"] || 0
      );
    });
  });

  const contractSummary = Object.entries(contracts)
    .map(([contract, values]) => ({
      contract,
      totalStops: values.totalStops,
      completedStops: values.completedStops,
      incompleteStops: values.incompleteStops,
      percentComplete:
        values.totalStops > 0
          ? values.completedStops /
            values.totalStops
          : 0,
    }))
    .sort(
      (a, b) =>
        a.percentComplete - b.percentComplete
    );

  return {
    contracts: contractSummary,
  };
}