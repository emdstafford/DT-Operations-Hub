import Link from "next/link";

export default function Sidebar() {
  return (
    <aside className="w-64 bg-[#0A2342] text-white min-h-screen">
      <div className="p-6">
        <h2 className="text-2xl font-bold">
          DT Hub
        </h2>
      </div>

      <nav className="px-4">
        <ul className="space-y-2">

          <li>
            /
              Dashboard
            </Link>
          </li>

          <li>
            /contracts
              Contracts
            </Link>
          </li>

          <li>
            /supervisors
              Supervisors
            </Link>
          </li>

          <li>
            /geofence
              Geofence
            </Link>
          </li>

          <li>
            /insights
              Insights
            </Link>
          </li>

          <li>
            /upload
              Upload
            </Link>
          </li>

        </ul>
      </nav>
    </aside>
  );
}
