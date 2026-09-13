export default function WeeklyReportPage() {
  return (
    <main className="p-8">

      <h1 className="text-4xl font-bold">
        Weekly Operations Report
      </h1>

      <div className="grid grid-cols-4 gap-4 mt-6">

        <div className="bg-blue-100 p-4 rounded">
          <div>Overall Completion</div>
          <div className="text-2xl font-bold">
            94.25%
          </div>
        </div>

        <div className="bg-green-100 p-4 rounded">
          <div>Total Stops</div>
          <div className="text-2xl font-bold">
            30,945
          </div>
        </div>

        <div className="bg-yellow-100 p-4 rounded">
          <div>Completed Stops</div>
          <div className="text-2xl font-bold">
            29,165
          </div>
        </div>

        <div className="bg-red-100 p-4 rounded">
          <div>Incomplete Stops</div>
          <div className="text-2xl font-bold">
            1,780
          </div>
        </div>

      </div>

      <div className="bg-white rounded shadow p-4 mt-8">

        <h2 className="text-2xl font-bold mb-4">
          Upload Status
        </h2>

        <div className="grid grid-cols-3 gap-4">

          <div className="bg-green-100 p-4 rounded">
            <div>Contracts Found</div>
            <div className="text-2xl font-bold">
              58
            </div>
          </div>

          <div className="bg-blue-100 p-4 rounded">
            <div>Raw Loads</div>
            <div className="text-2xl font-bold">
              8,266
            </div>
          </div>

          <div className="bg-yellow-100 p-4 rounded">
            <div>Report Date</div>
            <div className="text-2xl font-bold">
              09/13/2026
            </div>
          </div>

        </div>

      </div>

      <div className="bg-white rounded shadow p-4 mt-8">

        <h2 className="text-2xl font-bold mb-4">
          Supervisor Rankings
        </h2>

        <ul className="space-y-2">

          <li>
            Tonya Capps-Owen - 99.06%
          </li>

          <li>
            Ronnie Wooldridge - 98.50%
          </li>

          <li>
            Jerry Bradwell - 98.40%
          </li>

          <li>
            Kevin Shields - 98.18%
          </li>

        </ul>

      </div>

      <div className="bg-white rounded shadow p-4 mt-8">

        <h2 className="text-2xl font-bold mb-4">
          Contracts Requiring Attention
        </h2>

        <table className="w-full border">

          <thead>
            <tr className="bg-slate-200">
              <th className="border p-2">
                Contract
              </th>

              <th className="border p-2">
                Completion %
              </th>
            </tr>
          </thead>

          <tbody>

            <tr className="bg-red-100">
              <td className="border p-2">
                3173X
              </td>

              <td className="border p-2">
                26.03%
              </td>
            </tr>

            <tr className="bg-red-100">
              <td className="border p-2">
                3824J
              </td>

              <td className="border p-2">
                70.00%
              </td>
            </tr>

            <tr className="bg-red-100">
              <td className="border p-2">
                3606M
              </td>

              <td className="border p-2">
                83.34%
              </td>
            </tr>

            <tr className="bg-red-100">
              <td className="border p-2">
                31730
              </td>

              <td className="border p-2">
                85.63%
              </td>
            </tr>

            <tr className="bg-red-100">
              <td className="border p-2">
                3889P
              </td>

              <td className="border p-2">
                88.70%
              </td>
            </tr>

          </tbody>

        </table>

      </div>

    </main>
  );
}