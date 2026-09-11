"use client";

import { useState } from "react";
import { processReport } from "@/lib/processors/reportProcessor";

export default function UploadPage() {
  const [fileName, setFileName] = useState("");
  const [contracts, setContracts] = useState<any[]>([]);

  async function handleFileSelect(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0];

    if (!file) return;

    setFileName(file.name);

    const result = await processReport(file);

    setContracts(result.contracts);
  }

  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold">
        Weekly Report Upload
      </h1>

      <div className="mt-6">
        <input
          type="file"
          accept=".xlsx,.xlsm,.xls"
          onChange={handleFileSelect}
        />
      </div>

      {fileName && (
        <div className="mt-4 p-4 bg-green-100 rounded">
          Selected File: {fileName}
        </div>
      )}

      {contracts.length > 0 && (
        <div className="mt-8">
          <h2 className="text-2xl font-bold mb-4">
            Contract Summary
          </h2>

          <table className="border-collapse border w-full">
            <thead>
              <tr>
                <th className="border p-2">Contract</th>
                <th className="border p-2">Total Stops</th>
                <th className="border p-2">Completed</th>
                <th className="border p-2">Incomplete</th>
                <th className="border p-2">% Complete</th>
              </tr>
            </thead>

            <tbody>
              {contracts.map((contract) => (
                <tr key={contract.contract}>
                  <td className="border p-2">
                    {contract.contract}
                  </td>

                  <td className="border p-2">
                    {contract.totalStops}
                  </td>

                  <td className="border p-2">
                    {contract.completedStops}
                  </td>

                  <td className="border p-2">
                    {contract.incompleteStops}
                  </td>

                  <td className="border p-2">
                    {(contract.percentComplete * 100).toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}