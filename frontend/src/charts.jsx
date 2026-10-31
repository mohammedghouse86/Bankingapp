import { useLayoutEffect, useRef, useState } from 'react';
import { money } from './ui';

/** Measures the container so SVG coordinates map 1:1 to pixels (text stays crisp and readable). */
function useWidth(fallback = 640) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    if (!ref.current) return undefined;
    const update = () => { if (ref.current) setWidth(Math.max(280, Math.round(ref.current.clientWidth))); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
}

/** Stacked or grouped bars. series: [{ key, label }], data: [{ [xKey], ...values }] */
export function BarChart({ data, xKey, series, height = 240, stacked = true, format = (v) => compact.format(v), xFormat = (v) => v }) {
  const [hover, setHover] = useState(null);
  const [ref, W] = useWidth(); const H = height; const pad = { l: 44, r: 8, t: 10, b: 26 };
  const totals = data.map((d) => (stacked ? series.reduce((s, x) => s + (d[x.key] || 0), 0) : Math.max(...series.map((x) => d[x.key] || 0))));
  const max = niceMax(Math.max(0, ...totals));
  const iw = W - pad.l - pad.r; const ih = H - pad.t - pad.b;
  const bw = iw / Math.max(1, data.length);
  const y = (v) => pad.t + ih - (v / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const every = Math.ceil(data.length / 8);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bar chart">
        {ticks.map((t) => (
          <g key={t}><line className="grid-line" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} /><text x={pad.l - 6} y={y(t) + 4} textAnchor="end">{format(t)}</text></g>
        ))}
        {data.map((d, i) => {
          let acc = 0;
          const x0 = pad.l + i * bw;
          return (
            <g key={d[xKey]} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={x0} y={pad.t} width={bw} height={ih} fill="transparent" />
              {series.map((s, si) => {
                const v = d[s.key] || 0;
                if (stacked) {
                  const top = y(acc + v); const h = y(acc) - top; acc += v;
                  return <rect key={s.key} x={x0 + bw * 0.18} y={top} width={bw * 0.64} height={Math.max(0, h)} fill={COLORS[si]} rx={si === series.length - 1 ? 2 : 0} opacity={hover === null || hover === i ? 1 : 0.55} />;
                }
                const gw = (bw * 0.7) / series.length;
                return <rect key={s.key} x={x0 + bw * 0.15 + si * gw} y={y(v)} width={gw - 1} height={Math.max(0, pad.t + ih - y(v))} fill={COLORS[si]} rx={2} opacity={hover === null || hover === i ? 1 : 0.55} />;
              })}
              {i % every === 0 && <text x={x0 + bw / 2} y={H - 8} textAnchor="middle">{xFormat(d[xKey])}</text>}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${((pad.l + (hover + 0.5) * bw) / W) * 100}%`, top: `${(y(totals[hover]) / H) * 100}%` }}>
          <b>{xFormat(data[hover][xKey])}</b>
          {series.map((s) => <div key={s.key}>{s.label}: {s.money === false ? data[hover][s.key] : money(data[hover][s.key] || 0)}</div>)}
        </div>
      )}
      {series.length > 1 && <div className="legend">{series.map((s, i) => <span key={s.key}><i style={{ background: COLORS[i] }} />{s.label}</span>)}</div>}
    </div>
  );
}

/** Line/area chart for one or two series. */
export function AreaChart({ data, xKey, series, height = 220, format = (v) => compact.format(v), xFormat = (v) => v, valueFormat = (v) => v }) {
  const [hover, setHover] = useState(null);
  const [ref, W] = useWidth(); const H = height; const pad = { l: 44, r: 10, t: 10, b: 26 };
  const max = niceMax(Math.max(0, ...data.flatMap((d) => series.map((s) => d[s.key] || 0))));
  const iw = W - pad.l - pad.r; const ih = H - pad.t - pad.b;
  const x = (i) => pad.l + (data.length <= 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v) => pad.t + ih - (v / max) * ih;
  const every = Math.ceil(data.length / 8);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Line chart" onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}><line className="grid-line" x1={pad.l} x2={W - pad.r} y1={y(f * max)} y2={y(f * max)} /><text x={pad.l - 6} y={y(f * max) + 4} textAnchor="end">{format(f * max)}</text></g>
        ))}
        {series.map((s, si) => {
          const pts = data.map((d, i) => `${x(i)},${y(d[s.key] || 0)}`).join(' ');
          return (
            <g key={s.key}>
              {si === 0 && <polygon points={`${x(0)},${y(0)} ${pts} ${x(data.length - 1)},${y(0)}`} fill={COLORS[si]} opacity="0.08" />}
              <polyline points={pts} fill="none" stroke={COLORS[si]} strokeWidth="2.2" strokeLinejoin="round" />
            </g>
          );
        })}
        {data.map((d, i) => (
          <g key={d[xKey]}>
            <rect x={x(i) - iw / data.length / 2} y={pad.t} width={iw / Math.max(1, data.length)} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
            {i % every === 0 && <text x={x(i)} y={H - 8} textAnchor="middle">{xFormat(d[xKey])}</text>}
            {hover === i && series.map((s, si) => <circle key={s.key} cx={x(i)} cy={y(d[s.key] || 0)} r="4" fill={COLORS[si]} />)}
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(Math.max(...series.map((s) => data[hover][s.key] || 0))) / H) * 100}%` }}>
          <b>{xFormat(data[hover][xKey])}</b>
          {series.map((s) => <div key={s.key}>{s.label}: {valueFormat(data[hover][s.key] || 0)}</div>)}
        </div>
      )}
      {series.length > 1 && <div className="legend">{series.map((s, i) => <span key={s.key}><i style={{ background: COLORS[i] }} />{s.label}</span>)}</div>}
    </div>
  );
}

/** Donut with legend. items: [{ label, value }] */
export function Donut({ items, format = (v) => v, size = 160 }) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const r = 60; const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="row" style={{ gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg viewBox="0 0 160 160" width={size} height={size} role="img" aria-label="Donut chart">
        <circle cx="80" cy="80" r={r} fill="none" stroke="var(--neutral-50)" strokeWidth="22" />
        {items.map((it, i) => {
          const len = (it.value / total) * c;
          const el = <circle key={it.label} cx="80" cy="80" r={r} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth="22" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 80 80)" />;
          offset += len;
          return el;
        })}
      </svg>
      <div className="stack" style={{ gap: 8, flex: 1, minWidth: 140 }}>
        {items.map((it, i) => (
          <div key={it.label} className="row between" style={{ fontSize: 13 }}>
            <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: COLORS[i % COLORS.length], marginRight: 8 }} />{it.label}</span>
            <b>{format(it.value)}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BarList({ items, format = money }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="bar-list">
      {items.map((it) => (
        <div className="bar-row" key={it.label}>
          <span className="nowrap" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</span>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${(it.value / max) * 100}%` }} /></div>
          <b className="right">{format(it.value)}</b>
        </div>
      ))}
    </div>
  );
}
