import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ForecastPoint } from "../insights";
import { cn } from "../lib/utils";

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
    <div
      className="pointer-events-none absolute z-2 grid min-w-37.5 gap-0.5 rounded-control border border-border-hover bg-elevated px-2.5 py-2 text-sm text-secondary shadow-float"
      style={{ left: x, top: y }}
      role="status"
    >
      {children}
    </div>
  );
}

function TooltipTitle({ children }: { children: ReactNode }) {
  return <span className="flex items-center gap-1.5 text-xs text-muted">{children}</span>;
}

function TooltipRow({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <span className={cn("flex items-center gap-1.5", muted && "text-muted")}>{children}</span>;
}

function TooltipValue({ children }: { children: ReactNode }) {
  return <b className="font-semibold text-foreground tabular-nums">{children}</b>;
}

const KEY_LINES = {
  primary: "bg-primary",
  trend: "bg-chart-trend",
  dashed: "bg-dashed-key",
};

/** Line sample for a chart legend. */
export function LineKey({ variant }: { variant: keyof typeof KEY_LINES }) {
  return <i className={cn("inline-block h-0.5 w-3 rounded-xs", KEY_LINES[variant])} />;
}

/** Filled square sample for a chart legend. */
export function BoxKey({ accent = false }: { accent?: boolean }) {
  return (
    <i className={cn("inline-block size-2 rounded-sm", accent ? "bg-primary" : "bg-chart-3")} />
  );
}

export function LegendInline({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-3.5 text-sm text-secondary">{children}</div>;
}

export function LegendItem({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap">{children}</span>;
}

const SEGMENT_FILLS = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"];

const axisText = "fill-muted text-xs tabular-nums";

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
    <div className="relative w-full" ref={ref}>
      {width > 0 && (
        <svg
          className="block overflow-visible"
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
                className="stroke-divider"
                x1={pad.left}
                x2={width - pad.right}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text className={axisText} x={pad.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
                {fmt(tick)}
              </text>
            </g>
          ))}
          {points.map((point, index) =>
            index % labelEvery === 0 ? (
              <text
                key={point.week}
                className={axisText}
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
                className="fill-white/2"
                x={x(firstProjected - 1)}
                y={pad.top}
                width={x(points.length - 1) - x(firstProjected - 1)}
                height={plotHeight}
              />
              <polygon className="fill-primary opacity-10" points={band} />
            </>
          )}
          <polyline
            className="fill-none stroke-chart-trend"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            points={line(actual.map((point, index) => [x(index), y(point.fitted)]))}
          />
          <polyline
            className="fill-none stroke-primary"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            points={line(actual.map((point, index) => [x(index), y(point.actual ?? point.fitted)]))}
          />
          {projected.length > 0 && (
            <polyline
              className="fill-none stroke-primary"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="4 4"
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
                className="stroke-border-hover"
                x1={x(hover)}
                x2={x(hover)}
                y1={pad.top}
                y2={pad.top + plotHeight}
              />
              <circle
                className="fill-primary stroke-surface"
                strokeWidth={2}
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
          <TooltipTitle>Week of {shortDate(active.week)}</TooltipTitle>
          {active.actual !== null ? (
            <TooltipRow>
              <LineKey variant="primary" />
              <TooltipValue>{fmt(active.actual)}</TooltipValue> tickets
            </TooltipRow>
          ) : (
            <TooltipRow>
              <LineKey variant="dashed" />
              <TooltipValue>{fmt(active.fitted)}</TooltipValue> projected
            </TooltipRow>
          )}
          <TooltipRow muted>
            95% band {fmt(active.low)}–{fmt(active.high)}
          </TooltipRow>
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

export function BarListRoot({ children }: { children: ReactNode }) {
  return <div className="grid gap-0.5">{children}</div>;
}

/** One labelled horizontal bar; `width` is a CSS width relative to the longest bar. */
export function BarListItem({
  label,
  note,
  width,
  accent = false,
  value,
  share,
  title,
}: {
  label: string;
  note?: string;
  width: string;
  accent?: boolean;
  value: string;
  share?: string;
  title?: string;
}) {
  return (
    <div
      className="grid min-h-6.5 grid-cols-bar-row items-center gap-3 rounded-lg text-sm text-secondary hover:bg-hover focus-visible:bg-hover"
      title={title}
      tabIndex={title === undefined ? undefined : 0}
    >
      <span className="truncate">
        {label}
        {note && <small className="ml-1.5 text-muted">{note}</small>}
      </span>
      <span className="flex h-2">
        <span
          className={cn("h-full min-w-0.5 rounded-r-md", accent ? "bg-primary" : "bg-chart-3")}
          style={{ width }}
        />
      </span>
      <span className="text-right font-medium text-foreground tabular-nums">
        {value}
        {share !== undefined && (
          <small className="inline-block w-10 text-xs font-normal text-muted">{share}</small>
        )}
      </span>
    </div>
  );
}

export function BarList({ rows, total }: { rows: BarRow[]; total?: number }) {
  const max = Math.max(...rows.map((row) => row.value), 1);

  return (
    <BarListRoot>
      {rows.map((row) => (
        <BarListItem
          key={row.label}
          label={row.label}
          note={row.note}
          accent={row.highlight}
          width={`${(row.value / max) * 100}%`}
          value={row.value.toLocaleString("en-US")}
          share={total === undefined ? undefined : `${((row.value / total) * 100).toFixed(1)}%`}
          title={`${row.label}: ${row.value.toLocaleString("en-US")}`}
        />
      ))}
    </BarListRoot>
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
    <div className="relative w-full" ref={ref}>
      {width > 0 && (
        <svg
          className="block overflow-visible"
          width={width}
          height={height}
          role="img"
          aria-label={label}
        >
          <line
            className="stroke-border-hover"
            x1={pad.left}
            x2={width - pad.right}
            y1={y(0)}
            y2={y(0)}
          />
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
                className="focus:outline-none"
              >
                <rect
                  className="fill-transparent"
                  x={pad.left + index * slot}
                  y={pad.top}
                  width={slot}
                  height={plotHeight}
                />
                <path
                  className={hover === index ? "fill-primary" : "fill-chart-3"}
                  d={`M${left},${y(0)} V${top + radius} Q${left},${top} ${left + radius},${top} H${
                    left + barWidth - radius
                  } Q${left + barWidth},${top} ${left + barWidth},${top + radius} V${y(0)} Z`}
                />
                {index % Math.ceil(values.length / Math.max(1, Math.floor(width / 36))) === 0 && (
                  <text
                    className={axisText}
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
            className="stroke-muted"
            x1={pad.left}
            x2={width - pad.right}
            y1={y(mean)}
            y2={y(mean)}
          />
        </svg>
      )}
      {hover !== null && (
        <Tooltip x={Math.min(pad.left + hover * slot + slot, width - 150)} y={4}>
          <TooltipTitle>{labels[hover]}</TooltipTitle>
          <TooltipRow>
            <TooltipValue>{fmt(values[hover])}</TooltipValue> tickets
          </TooltipRow>
          <TooltipRow muted>
            {values[hover] >= mean ? "+" : ""}
            {(((values[hover] - mean) / mean) * 100).toFixed(1)}% vs mean
          </TooltipRow>
        </Tooltip>
      )}
    </div>
  );
}

export function StackedBar({ rows, total }: { rows: BarRow[]; total: number }) {
  const [hover, setHover] = useState<string | null>(null);

  return (
    <>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-md bg-hover">
        {rows.map((row, index) => (
          <span
            key={row.label}
            className={cn("h-full", SEGMENT_FILLS[index], hover === row.label && "brightness-125")}
            style={{ width: `${(row.value / total) * 100}%` }}
            title={`${row.label}: ${row.value.toLocaleString("en-US")}`}
            onPointerEnter={() => setHover(row.label)}
            onPointerLeave={() => setHover(null)}
          />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        {rows.map((row, index) => (
          <span
            key={row.label}
            className={cn(
              "flex h-8 items-center gap-2 border-b border-divider text-sm text-secondary",
              hover === row.label && "text-foreground",
            )}
            onPointerEnter={() => setHover(row.label)}
            onPointerLeave={() => setHover(null)}
          >
            <i className={cn("size-2 rounded-sm", SEGMENT_FILLS[index])} />
            {row.label}
            <b className="ml-auto font-medium text-foreground tabular-nums">
              {row.value.toLocaleString("en-US")}
              <small className="ml-1.5 text-xs font-normal text-muted">
                {((row.value / total) * 100).toFixed(0)}%
              </small>
            </b>
          </span>
        ))}
      </div>
    </>
  );
}
