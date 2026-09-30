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

  async function upload(file?: File) {
    if (!file) return;
    setError(''); setName(file.name);
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
    } catch (e) { setRows([]); setError(e instanceof Error ? e.message : 'Unable to read workbook.'); }
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
      const miles = n(r['FINAL MILES']); if (miles) item.miles.push(miles);
    }
    return [...map.entries()].map(([key, v]): Summary => {
      const [contract, trip] = key.split('|');
      const finalMiles = v.miles.length ? Math.max(...v.miles) : 0;
      return { contract, trip, days: v.dates.size, finalMiles, payableMiles: finalMiles, totalPaidMiles: finalMiles * v.dates.size, overContract: false };
    }).sort((a,b) => a.contract.localeCompare(b.contract) || Number(a.trip)-Number(b.trip));
  }, [rows]);

  const totals = useMemo(() => summary.reduce<Record<string, number>>((a,r) => { a[r.contract]=(a[r.contract]||0)+r.totalPaidMiles; return a; },{}), [summary]);

  return <>
    <section className="card" style={{marginBottom:16}}>
      <h2>Upload CLEAR</h2>
      <p>Upload the original CLEAR workbook. The Hub finds the real header row automatically (including the standard row 13 export) and ignores trips not assigned to Tonya.</p>
      <input type="file" accept=".xlsx,.xls" onChange={e => upload(e.target.files?.[0])}/>
      {name && <p className="muted">Loaded: <strong>{name}</strong></p>}
      {error && <p style={{color:'crimson'}}>{error}</p>}
      <p className="muted"><strong>No CLEAR charge, billed, paid, interest, discount, payment, or check fields are displayed.</strong></p>
    </section>

    {summary.length > 0 && <section className="card" style={{marginBottom:16}}>
      <h2>Tonya CLEAR actuals</h2>
      <div style={{display:'flex',gap:20,flexWrap:'wrap',marginBottom:12}}>
        <strong>{summary.length} assigned trips found</strong>
        {Object.entries(totals).map(([c,t]) => <span key={c}><strong>{c}:</strong> {t.toLocaleString(undefined,{maximumFractionDigits:1})} CLEAR miles</span>)}
      </div>
      <div className="table-wrap"><table><thead><tr><th>Contract</th><th>CLEAR Trip</th><th>Days Ran</th><th>Final Miles / Trip</th><th>Actual CLEAR Miles</th></tr></thead><tbody>
        {summary.map(r => <tr key={`${r.contract}-${r.trip}`}><td>{r.contract}</td><td>{r.trip}</td><td>{r.days}</td><td>{r.finalMiles.toFixed(1)}</td><td>{r.totalPaidMiles.toLocaleString(undefined,{minimumFractionDigits:1,maximumFractionDigits:1})}</td></tr>)}
      </tbody></table></div>
      <p className="muted">This first pass proves the raw CLEAR import and Tonya filtering. Contract-frequency expected days, SVC mileage caps, EIA-approved rates, exceptions, saved history, and the combined printable report are added on top of this result.</p>
    </section>}
  </>;
}
