import * as XLSX from "xlsx";
import { getContracts } from "../getContracts";

export async function processReport(file: File) {
  const data = await file.arrayBuffer();

  const workbook = XLSX.read(data);

  const loadDetailsSheet =
    workbook.Sheets["Load Details"];

  if (!loadDetailsSheet) {
    return {
      contracts: [],
      rows: [],
    };
  }

  const rows: any[] =
  XLSX.utils.sheet_to_json(loadDetailsSheet, {
    range: 4,
  });

  const contractList = await getContracts();

  const contracts: Record<
    string,
    {
      totalStops: number;
      completedStops: number;
      incompleteStops: number;
    }
  > = {};

  rows.forEach((row) => {
  const tags = String(
    row["Tags"] || ""
  ).toUpperCase();

  console.log(tags);

  contractList.forEach((record: any) => {
      const contract = String(
        record.contract_number || ""
      ).trim();

      if (!contract) return;

      if (
        tags.includes(
          contract.toUpperCase()
        )
      ) {
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
      }
    });
  });

  const contractSummary = Object.entries(
    contracts
  ).map(([contract, values]) => ({
    contract,
    totalStops: values.totalStops,
    completedStops:
      values.completedStops,
    incompleteStops:
      values.incompleteStops,
    percentComplete:
      values.totalStops > 0
        ? values.completedStops /
          values.totalStops
        : 0,
  }));

  return {
    contracts: contractSummary,
    rows,
  };
}