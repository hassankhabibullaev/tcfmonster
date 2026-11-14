// The admin's charts, plain HTML (no library): columns over days, a list of meters, a split bar, a meter with its lines.
// One hue for one series (--c1), the categorical order --c1 coral · --c2 blue · --c3 yellow · --c4 aqua for parts
// (validated with the dataviz checks in light and dark), status colours only when a colour means good or bad, and
// every figure written beside its mark, so no colour stands alone. Each mark shows its value on hover.
import { useState, type ReactNode } from "react";

export const SERIES = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)"] as const;
const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);
const fmt = (n: number) => Math.round(n).toLocaleString("en-US").replaceAll(",", " ");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDay = (d: string) => { const x = new Date(d + "T12:00:00"); return `${x.getDate()} ${MON[x.getMonth()]}`; };

/** columns over days: one series, or several stacked (each part its own block, a 2px gap between); hover tells the day */
export function Columns({ days, parts, height = 150, label, unit }: {
  days: { day: string; values: number[] }[]; parts: { name: string; color?: string }[]; height?: number; label: string; unit?: (n: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = days.map((d) => d.values.reduce((a, b) => a + b, 0));
  const top = Math.max(1, ...totals);
  const nice = niceTop(top);
  const say = unit ?? ((n: number) => fmt(n));
  const h = hover != null ? days[hover] : null;
  return (
    <figure className="ch-cols" aria-label={label}>
      <div className="ch-cols-plot" style={{ height }} onMouseLeave={() => setHover(null)}>
        <div className="ch-grid" aria-hidden="true"><span data-v={fmt(nice)} /><span data-v={fmt(nice / 2)} /><span data-v="0" /></div>
        <div className="ch-cols-bars">
          {days.map((d, i) => (
            <div key={d.day} className="ch-col" data-on={hover === i || undefined} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}
              aria-label={`${shortDay(d.day)}: ${parts.map((p, k) => `${p.name} ${d.values[k]}`).join(", ")}`}>
              <div className="ch-col-stack" style={{ height: `${(totals[i] / nice) * 100}%` }}>
                {d.values.map((v, k) => v > 0 && <i key={k} style={{ flexGrow: v, background: parts[k].color ?? SERIES[k] }} />)}
              </div>
            </div>
          ))}
        </div>
        {h && hover != null && (
          <div className="ch-tip" style={{ left: `${((hover + 0.5) / days.length) * 100}%` }}>
            <b>{shortDay(h.day)}</b>
            {parts.map((p, k) => <span key={p.name}>{parts.length > 1 && <i style={{ background: p.color ?? SERIES[k] }} />}{p.name}: <b>{say(h.values[k])}</b></span>)}
          </div>
        )}
      </div>
      <figcaption className="ch-axis"><span>{shortDay(days[0].day)}</span><span>{shortDay(days[Math.floor(days.length / 2)].day)}</span><span>{shortDay(days[days.length - 1].day)}</span></figcaption>
      {parts.length > 1 && <Legend parts={parts.map((p, k) => ({ name: p.name, color: p.color ?? SERIES[k] }))} />}
    </figure>
  );
}
function niceTop(n: number) {
  const p = Math.pow(10, Math.floor(Math.log10(n)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= n) return m * p;
  return 10 * p;
}

export function Legend({ parts }: { parts: { name: string; color: string; n?: ReactNode }[] }) {
  return <ul className="ch-legend">{parts.map((p) => <li key={p.name}><i style={{ background: p.color }} />{p.name}{p.n != null && <b>{p.n}</b>}</li>)}</ul>;
}

/** a list of meters, one per named row, bars aligned: the share of `of`, the figure and the share written beside it.
 *  `low` marks a row under that share (a feature hardly used). */
export function Meters({ rows, of, low, sort }: { rows: { label: ReactNode; n: number; note?: ReactNode; key?: string }[]; of: number; low?: number; sort?: boolean }) {
  const list = sort ? [...rows].sort((a, b) => b.n - a.n) : rows;
  return (
    <ul className="ch-meters">
      {list.map((r, i) => {
        const p = pct(r.n, of);
        const isLow = low != null && p < low;
        return (
          <li key={r.key ?? i} data-low={isLow || undefined} title={`${fmt(r.n)} of ${fmt(of)} · ${p} %`}>
            <span className="ch-m-label">{r.label}{r.note && <small>{r.note}</small>}</span>
            <span className="ch-m-track"><i style={{ width: `${Math.max(p, r.n ? 1.5 : 0)}%` }} /></span>
            <span className="ch-m-n"><b>{p} %</b><small>{fmt(r.n)}</small></span>
          </li>
        );
      })}
    </ul>
  );
}

/** one whole split into its parts: a tall bar, each part its own block with its share printed where it fits, and a
 *  legend with the names and the counts */
export function Split({ parts, label }: { parts: { name: string; n: number; color?: string }[]; label: string }) {
  const total = parts.reduce((a, p) => a + p.n, 0);
  const shown = parts.map((p, k) => ({ ...p, color: p.color ?? SERIES[k] }));
  if (!total) return <p className="muted small">Nothing to count yet.</p>;
  return (
    <figure className="ch-split" aria-label={label}>
      <div className="ch-split-bar">
        {shown.filter((p) => p.n > 0).map((p) => {
          const s = pct(p.n, total);
          return <i key={p.name} style={{ flexGrow: p.n, background: p.color }} title={`${p.name}: ${fmt(p.n)} · ${s} %`}>{s >= 9 && <span>{s} %</span>}</i>;
        })}
      </div>
      <Legend parts={shown.map((p) => ({ name: p.name, color: p.color, n: fmt(p.n) }))} />
    </figure>
  );
}

/** a used amount against its lines: the bar fills toward `max`; marks at each line, named under */
export function Gauge({ used, max, lines = [], hot }: { used: number; max: number; lines?: { at: number; name: string }[]; hot?: boolean }) {
  return (
    <div className="ch-gauge">
      <div className="ch-gauge-track"><i data-hot={hot || undefined} style={{ width: `${Math.min(100, (used / max) * 100)}%` }} />
        {lines.map((l) => <b key={l.name} style={{ left: `${(l.at / max) * 100}%` }} title={`${l.name}: ${fmt(l.at)}`} />)}
      </div>
      <div className="ch-gauge-scale"><span>0</span>{lines.map((l) => <span key={l.name} style={{ left: `${(l.at / max) * 100}%` }}>{l.name}</span>)}<span>{fmt(max)}</span></div>
    </div>
  );
}
