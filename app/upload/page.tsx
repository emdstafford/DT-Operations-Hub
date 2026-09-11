"use client";

import { useState } from "react";
import { processReport } from "@/lib/processors/reportProcessor";
import { saveContractsToDatabase } from "@/lib/saveContracts";
import { updateContractMaster } from "@/lib/updateContractMaster";
import Sidebar from "@/components/Sidebar";

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

  async function handleSave() {
    try {
      await updateContractMaster(contracts);

      await saveContractsToDatabase(contracts);

      alert(
        `${contracts.length} contracts saved successfully!`
      );
    } catch (error) {
      console.error(error);

      alert("Failed to save contracts.");
    }
  }

  return (
    <div className="flex">
      <Sidebar />

      <main className="flex-1 min-h-screen bg-slate-100 p-8">
        <div className="bg-white rounded-lg shadow p-6">
          <h1 className="text-3xl font-bold mb-6">
            Weekly Report Upload
          </h1>

          <input
            type="file"
            accept=".xlsx,.xlsm,.xls"
            onChange={handleFileSelect}
          />

          {fileName && (
            <div className="mt-4 p-4 bg-green-100 rounded">
              Selected File: {fileName}
            </div>
          )}

          {contracts.length > 0 && (
            <>
              <div className="mt-4">
                <button
  onClick={handleSave}
  className="bg-yellow-500 text-black px-4 py-2 rounded"
>
  Save Weekly Summary
</button>
              </div>

              <div className="mt-8">
                <h2 className="text-2xl font-bold mb-4">
                  Contract Summary ({contracts.length} contracts)
                </h2>

                <table className="w-full border border-slate-300">
                  <thead>
                    <tr className="bg-slate-200">
                      <th className="border p-2 text-left">Contract</th>
                      <th className="border p-2 text-left">
                        Total Stops
                      </th>
                      <th className="border p-2 text-left">
                        Completed
                      </th>
                      <th className="border p-2 text-left">
                        Incomplete
                      </th>
                      <th className="border p-2 text-left">
                        % Complete
                      </th>
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
            </>
          )}
        </div>
      </main>
    </div>
  );
}