'use client';

import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';

type ClearRow = Record<string, unknown>;
type Summary = { contract: string; trip: string; days: number; finalMiles: number; payableMiles: number; totalPaidMiles: number; overContract: boolean };

const TONYA: Record<string, Set<string>> = {
  '296B8': new Set(['7','8','9','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','29','30','33','34','39','40','41','42','43','44','45','46','321','322']),
  '296C2': new Set(['77','78','79','80','81','82','83','84','85','86','87','88','89','90','91','92','93','94','95','96','97','98','157','158','159','160','161','162','163','164','165','166','167','168','169','170','1017','1018','1019','1020']),
};

function n(v: unknown) { const x = Number(v); return Number.isFinite(x) ? x : 0; }
function s(v: unknown) { return String(v ?? '').trim(); }

export default function MonthlyClearReconciliation() {
  const [rows, setRows] = useState<ClearRow[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function upload(file?: File) {
    if (!file) return;
    setError('');
    setName(file.name);
    setLoading(true);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });
      const headerIndex = matrix.findIndex(r => Array.isArray(r) && r.some(c => s(c).toUpperCase() === 'CONTRACT') && r.some(c => s(c).toUpperCase() === 'SV TRIP ID'));
      if (headerIndex < 0) throw new Error('Could not find the CLEAR header row. Expected CONTRACT and SV TRIP ID.');
      const headers = (matrix[headerIndex] as unknown[]).map(v => s(v).toUpperCase());
      const data = matrix.slice(headerIndex + 1).map(r => {
        const out: ClearRow = {};
        headers.forEach((h, i) => { if (h) out[h] = (r as unknown[])[i]; });
        return out;
      });
      setRows(data.filter(r => TONYA[s(r.CONTRACT)]?.has(s(r['SV TRIP ID']))));
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : 'Unable to read workbook.');
    } finally {
      setLoading(false);
    }
  }

  const summary = useMemo(() => {
    const map = new Map<string, { dates: Set<string>; miles: number[] }>();
    for (const r of rows) {
      const contract = s(r.CONTRACT), trip = s(r['SV TRIP ID']);
      const key = `${contract}|${trip}`;
      if (!map.has(key)) map.set(key, { dates: new Set(), miles: [] });
      const item = map.get(key)!;
      const d = r['PLANNED START'];
      const date = d instanceof Date ? d.toISOString().slice(0,10) : s(d).slice(0,10);
      if (date) item.dates.add(date);
      const miles = n(r['FINAL MILES']);
      if (miles) item.miles.push(miles);
    }
    return [...map.entries()].map(([key, v]): Summary => {
      const [contract, trip] = key.split('|');
      const finalMiles = v.miles.length ? Math.max(...v.miles) : 0;
      return { contract, trip, days: v.dates.size, finalMiles, payableMiles: finalMiles, totalPaidMiles: finalMiles * v.dates.size, overContract: false };
    }).sort((a,b) => a.contract.localeCompare(b.contract) || Number(a.trip)-Number(b.trip));
  }, [rows]);

  const totals = useMemo(() => summary.reduce<Record<string, number>>((a,r) => {
    a[r.contract] = (a[r.contract] || 0) + r.totalPaidMiles;
    return a;
  }, {}), [summary]);

  const totalDays = useMemo(() => summary.reduce((sum, r) => sum + r.days, 0), [summary]);
  const totalMiles = useMemo(() => summary.reduce((sum, r) => sum + r.totalPaidMiles, 0), [summary]);

  return <>
    <section className="card" style={{ marginBottom: 18 }}>
      <p className="eyebrow">Step 3</p>
      <h2 style={{ marginTop: 0, marginBottom: 6 }}>Upload CLEAR</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Use the untouched CLEAR workbook. The Hub finds the real header row automatically, including the standard row 13 export.
      </p>

      <label
        style={{
          display: 'block',
          marginTop: 16,
          padding: '28px 18px',
          border: '2px dashed #b9c6d6',
          borderRadius: 12,
          background: '#f8fafc',
          textAlign: 'center',
          cursor: 'pointer',
        }}
      >
        <div style={{ fontSize: 30, marginBottom: 8 }}>⇧</div>
        <div style={{ fontWeight: 800, color: '#0f2747', fontSize: 16 }}>
          {loading ? 'Reading CLEAR workbook…' : 'Choose CLEAR workbook'}
        </div>
        <div className="muted" style={{ fontSize: 13, marginTop: 5 }}>
          Excel .xlsx or .xls • no cleanup required before upload
        </div>
        <input
          type="file"
          accept=".xlsx,.xls"
          disabled={loading}
          onChange={e => upload(e.target.files?.[0])}
          style={{ display: 'none' }}
        />
      </label>

      {name && !error && (
        <div style={{ marginTop: 12, padding: 11, borderRadius: 9, background: '#eef4fb', color: '#0f2747' }}>
          <strong>Loaded:</strong> {name}
        </div>
      )}
      {error && (
        <div style={{ marginTop: 12, padding: 11, borderRadius: 9, background: '#fff1f2', color: '#9f1239', border: '1px solid #fecdd3' }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 14, padding: 12, borderRadius: 9, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
        <strong style={{ color: '#0f2747' }}>Privacy rule:</strong>{' '}
        <span className="muted">CLEAR charge, billed, paid, interest, discount, payment, and check fields are never shown on this report.</span>
      </div>
    </section>

    {summary.length === 0 && !loading && name && !error && (
      <section className="card" style={{ marginBottom: 18, textAlign: 'center', padding: 26 }}>
        <h3 style={{ marginTop: 0 }}>No Tonya-assigned trips found</h3>
        <p className="muted" style={{ marginBottom: 0 }}>Check that the workbook contains 296B8 or 296C2 CLEAR activity for the selected month.</p>
      </section>
    )}

    {summary.length > 0 && <section className="card" style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <p className="eyebrow">Step 4</p>
          <h2 style={{ marginTop: 0, marginBottom: 5 }}>Tonya CLEAR actuals</h2>
          <p className="muted" style={{ marginTop: 0 }}>Only assigned contract trips are included below.</p>
        </div>
        <span style={{ padding: '6px 10px', borderRadius: 999, background: '#ecfdf5', color: '#166534', fontWeight: 800, fontSize: 12 }}>
          FILE READ SUCCESSFULLY
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, margin: '16px 0' }}>
        <div style={{ padding: 14, borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
          <div className="muted" style={{ fontSize: 12 }}>ASSIGNED TRIPS FOUND</div>
          <div style={{ fontSize: 26, fontWeight: 850, color: '#0f2747' }}>{summary.length}</div>
        </div>
        <div style={{ padding: 14, borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
          <div className="muted" style={{ fontSize: 12 }}>TOTAL DAYS RAN</div>
          <div style={{ fontSize: 26, fontWeight: 850, color: '#0f2747' }}>{totalDays}</div>
        </div>
        <div style={{ padding: 14, borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
          <div className="muted" style={{ fontSize: 12 }}>ACTUAL CLEAR MILES</div>
          <div style={{ fontSize: 26, fontWeight: 850, color: '#0f2747' }}>{totalMiles.toLocaleString(undefined,{maximumFractionDigits:1})}</div>
        </div>
        <div style={{ padding: 14, borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
          <div className="muted" style={{ fontSize: 12 }}>CONTRACTS</div>
          <div style={{ fontSize: 18, fontWeight: 850, color: '#0f2747', marginTop: 6 }}>{Object.keys(totals).join(' • ')}</div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Contract</th><th>CLEAR Trip</th><th>Days Ran</th><th>Final Miles / Trip</th><th>Actual CLEAR Miles</th></tr></thead>
          <tbody>
            {summary.map(r => (
              <tr key={`${r.contract}-${r.trip}`}>
                <td><strong>{r.contract}</strong></td>
                <td>{r.trip}</td>
                <td>{r.days}</td>
                <td>{r.finalMiles.toFixed(1)}</td>
                <td>{r.totalPaidMiles.toLocaleString(undefined,{minimumFractionDigits:1,maximumFractionDigits:1})}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
        {Object.entries(totals).map(([c,t]) => (
          <div key={c} style={{ padding: '10px 12px', borderRadius: 9, background: '#eef4fb', color: '#0f2747' }}>
            <strong>{c}</strong> · {t.toLocaleString(undefined,{maximumFractionDigits:1})} CLEAR miles
          </div>
        ))}
      </div>
    </section>}
  </>;
}
