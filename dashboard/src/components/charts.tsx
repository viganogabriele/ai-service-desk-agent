import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ForecastPoint } from "../insights";

const fmt = (value: number) => Math.round(value).toLocaleString("en-US");

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const node = ref.current;

    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

function niceTicks(min: number, max: number, count: number) {
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw || 1));

  const step =
    [1, 2, 2.5, 5, 10].map((item) => item * magnitude).find((item) => item >= raw) ?? raw;

  const start = Math.floor(min / step) * step;
  const ticks = [];

  for (let value = start; value <= max + step / 2; value += step) ticks.push(value);

  return ticks;
}

function Tooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div className="chart-tooltip" style={{ left: x, top: y }} role="status">
      {children}
    </div>
  );
}

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

export function ForecastChart({ points }: { points: ForecastPoint[] }) {
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const height = 240;
  const pad = { top: 12, right: 12, bottom: 28, left: 44 };
  const plotWidth = Math.max(0, width - pad.left - pad.right);
  const plotHeight = height - pad.top - pad.bottom;
  const values = points.flatMap((point) => [point.low, point.high, point.actual ?? point.fitted]);
  const ticks = niceTicks(Math.min(...values) * 0.96, Math.max(...values) * 1.02, 4);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const x = (index: number) => pad.left + (index / Math.max(1, points.length - 1)) * plotWidth;
  const y = (value: number) => pad.top + (1 - (value - yMin) / (yMax - yMin)) * plotHeight;
  const firstProjected = points.findIndex((point) => point.projected);
  const actual = points.slice(0, firstProjected < 0 ? points.length : firstProjected);
  const projected = firstProjected < 0 ? [] : points.slice(firstProjected - 1);
  const line = (rows: [number, number][]) => rows.map(([a, b]) => `${a},${b}`).join(" ");

  const band = [
    ...projected.map((point, index) => [x(firstProjected - 1 + index), y(point.high)]),
    ...projected.map((point, index) => [x(firstProjected - 1 + index), y(point.low)]).reverse(),
  ]
    .map(([a, b]) => `${a},${b}`)
    .join(" ");

  const labelEvery = Math.ceil(points.length / Math.max(2, Math.floor(plotWidth / 70)));
  const active = hover === null ? null : points[hover];

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Weekly ticket intake with linear projection"
          onPointerMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const ratio = (event.clientX - box.left - pad.left) / plotWidth;
            setHover(
              Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))),
            );
          }}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                className="grid-line"
                x1={pad.left}
                x2={width - pad.right}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text className="axis-text" x={pad.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
                {fmt(tick)}
              </text>
            </g>
          ))}
          {points.map((point, index) =>
            index % labelEvery === 0 ? (
              <text
                key={point.week}
                className="axis-text"
                x={x(index)}
                y={height - 8}
                textAnchor="middle"
              >
                {shortDate(point.week)}
              </text>
            ) : null,
          )}
          {firstProjected > 0 && (
            <>
              <rect
                className="projection-zone"
                x={x(firstProjected - 1)}
                y={pad.top}
                width={x(points.length - 1) - x(firstProjected - 1)}
                height={plotHeight}
              />
              <polygon className="band" points={band} />
            </>
          )}
          <polyline
            className="series-trend"
            points={line(actual.map((point, index) => [x(index), y(point.fitted)]))}
          />
          <polyline
            className="series-line"
            points={line(actual.map((point, index) => [x(index), y(point.actual ?? point.fitted)]))}
          />
          {projected.length > 0 && (
            <polyline
              className="series-projection"
              points={line(
                projected.map((point, index) => [
                  x(firstProjected - 1 + index),
                  y(index === 0 ? (point.actual ?? point.fitted) : point.fitted),
                ]),
              )}
            />
          )}
          {active && hover !== null && (
            <>
              <line
                className="crosshair"
                x1={x(hover)}
                x2={x(hover)}
                y1={pad.top}
                y2={pad.top + plotHeight}
              />
              <circle
                className="end-dot"
                cx={x(hover)}
                cy={y(active.actual ?? active.fitted)}
                r={4}
              />
            </>
          )}
        </svg>
      )}
      {active && hover !== null && (
        <Tooltip x={Math.min(x(hover) + 12, width - 190)} y={8}>
          <span className="tooltip-title">Week of {shortDate(active.week)}</span>
          {active.actual !== null ? (
            <span>
              <i className="key accent" />
              <b>{fmt(active.actual)}</b> tickets
            </span>
          ) : (
            <span>
              <i className="key dashed" />
              <b>{fmt(active.fitted)}</b> projected
            </span>
          )}
          <span className="muted">
            95% band {fmt(active.low)}–{fmt(active.high)}
          </span>
        </Tooltip>
      )}
    </div>
  );
}

export interface BarRow {
  label: string;
  value: number;
  highlight?: boolean;
  note?: string;
}

export function BarList({ rows, total }: { rows: BarRow[]; total?: number }) {
  const max = Math.max(...rows.map((row) => row.value), 1);

  return (
    <div className="bar-list">
      {rows.map((row) => (
        <div
          className="bar-row"
          key={row.label}
          title={`${row.label}: ${row.value.toLocaleString("en-US")}`}
          tabIndex={0}
        >
          <span className="bar-name">
            {row.label}
            {row.note && <small>{row.note}</small>}
          </span>
          <span className="bar-track">
            <span
              className={row.highlight ? "bar-fill accent" : "bar-fill"}
              style={{ width: `${(row.value / max) * 100}%` }}
            />
          </span>
          <span className="bar-value num">
            {row.value.toLocaleString("en-US")}
            {total !== undefined && <small>{((row.value / total) * 100).toFixed(1)}%</small>}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ColumnChart({
  values,
  labels,
  label,
}: {
  values: number[];
  labels: string[];
  label: string;
}) {
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const height = 150;
  const pad = { top: 10, right: 4, bottom: 22, left: 4 };
  const plotHeight = height - pad.top - pad.bottom;
  const max = Math.max(...values, 1);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const slot = (width - pad.left - pad.right) / values.length;
  const barWidth = Math.min(24, Math.max(2, slot - 2));
  const y = (value: number) => pad.top + (1 - value / max) * plotHeight;

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label}>
          <line className="axis-line" x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} />
          {values.map((value, index) => {
            const left = pad.left + index * slot + (slot - barWidth) / 2;
            const top = y(value);
            const radius = Math.min(4, barWidth / 2, y(0) - top);

            return (
              <g
                key={labels[index]}
                onPointerEnter={() => setHover(index)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(index)}
                onBlur={() => setHover(null)}
                tabIndex={0}
              >
                <rect
                  className="hit"
                  x={pad.left + index * slot}
                  y={pad.top}
                  width={slot}
                  height={plotHeight}
                />
                <path
                  className={hover === index ? "column active" : "column"}
                  d={`M${left},${y(0)} V${top + radius} Q${left},${top} ${left + radius},${top} H${
                    left + barWidth - radius
                  } Q${left + barWidth},${top} ${left + barWidth},${top + radius} V${y(0)} Z`}
                />
                {index % Math.ceil(values.length / Math.max(1, Math.floor(width / 36))) === 0 && (
                  <text
                    className="axis-text"
                    x={left + barWidth / 2}
                    y={height - 6}
                    textAnchor="middle"
                  >
                    {labels[index]}
                  </text>
                )}
              </g>
            );
          })}
          <line
            className="mean-line"
            x1={pad.left}
            x2={width - pad.right}
            y1={y(mean)}
            y2={y(mean)}
          />
        </svg>
      )}
      {hover !== null && (
        <Tooltip x={Math.min(pad.left + hover * slot + slot, width - 150)} y={4}>
          <span className="tooltip-title">{labels[hover]}</span>
          <span>
            <b>{fmt(values[hover])}</b> tickets
          </span>
          <span className="muted">
            {values[hover] >= mean ? "+" : ""}
            {(((values[hover] - mean) / mean) * 100).toFixed(1)}% vs mean
          </span>
        </Tooltip>
      )}
    </div>
  );
}

export function StackedBar({ rows, total }: { rows: BarRow[]; total: number }) {
  const [hover, setHover] = useState<string | null>(null);

  return (
    <>
      <div className="stacked-bar tall">
        {rows.map((row, index) => (
          <span
            key={row.label}
            className={`segment segment-${index}${hover === row.label ? " active" : ""}`}
            style={{ width: `${(row.value / total) * 100}%` }}
            title={`${row.label}: ${row.value.toLocaleString("en-US")}`}
            onPointerEnter={() => setHover(row.label)}
            onPointerLeave={() => setHover(null)}
          />
        ))}
      </div>
      <div className="legend">
        {rows.map((row, index) => (
          <span
            key={row.label}
            className={hover === row.label ? "active" : ""}
            onPointerEnter={() => setHover(row.label)}
            onPointerLeave={() => setHover(null)}
          >
            <i className={`legend-dot segment-${index}`} />
            {row.label}
            <b>
              {row.value.toLocaleString("en-US")}
              <small>{((row.value / total) * 100).toFixed(0)}%</small>
            </b>
          </span>
        ))}
      </div>
    </>
  );
}
