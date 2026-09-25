import { useLayoutEffect, useRef, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
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
      className="pointer-events-none absolute z-2 grid min-w-37.5 gap-0.5 rounded-control bg-tooltip px-2.5 py-2 text-sm text-secondary shadow-popover"
      style={{ left: x, top: y }}
      role="status"
    >
      {children}
    </div>
  );
}

const keyTones = {
  accent: "bg-primary",
  trend: "bg-chart-trend",
  dashed: "bg-dashed-key",
};

/** A short line in a legend, drawn like the series it names. */
export function Key({ tone }: { tone: keyof typeof keyTones }) {
  return <i className={cn("inline-block h-0.5 w-3 rounded-full", keyTones[tone])} />;
}

/** A square legend swatch for bar colours. */
export function KeyBox({ accent = false }: { accent?: boolean }) {
  return (
    <i className={cn("inline-block size-2 rounded-xs", accent ? "bg-primary" : "bg-chart-3")} />
  );
}

export function Legend({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("flex flex-wrap gap-3.5 text-sm text-secondary", className)} {...props} />
  );
}

export function LegendItem({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}
      {...props}
    />
  );
}

const tooltipLine = "flex items-center gap-1.5";

const tooltipValue = "font-semibold text-tooltip-foreground tabular-nums";

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
              <text
                className="fill-muted text-xs tabular-nums"
                x={pad.left - 8}
                y={y(tick)}
                dy="0.32em"
                textAnchor="end"
              >
                {fmt(tick)}
              </text>
            </g>
          ))}
          {points.map((point, index) =>
            index % labelEvery === 0 ? (
              <text
                key={point.week}
                className="fill-muted text-xs tabular-nums"
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
                className="fill-row"
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
                cx={x(hover)}
                cy={y(active.actual ?? active.fitted)}
                r={4}
                strokeWidth={2}
              />
            </>
          )}
        </svg>
      )}
      {active && hover !== null && (
        <Tooltip x={Math.min(x(hover) + 12, width - 190)} y={8}>
          <span className={cn(tooltipLine, "text-xs text-muted")}>
            Week of {shortDate(active.week)}
          </span>
          {active.actual !== null ? (
            <span className={tooltipLine}>
              <Key tone="accent" />
              <b className={tooltipValue}>{fmt(active.actual)}</b> tickets
            </span>
          ) : (
            <span className={tooltipLine}>
              <Key tone="dashed" />
              <b className={tooltipValue}>{fmt(active.fitted)}</b> projected
            </span>
          )}
          <span className={cn(tooltipLine, "text-muted")}>
            95% band {fmt(active.low)}–{fmt(active.high)}
          </span>
        </Tooltip>
      )}
    </div>
  );
}

const fillTones = {
  neutral: "bg-chart-3",
  accent: "bg-primary",
  danger: "bg-danger",
  warning: "bg-warning",
  success: "bg-success",
};

export function Bars({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("grid gap-0.5", className)} {...props} />;
}

/** One labelled horizontal bar. On phones the bar drops under its label and value. */
export function Bar({
  label,
  width,
  tone = "neutral",
  value,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  label: ReactNode;
  width: string;
  tone?: keyof typeof fillTones;
  value: ReactNode;
}) {
  return (
    <div
      className={cn(
        "group grid min-h-7 grid-cols-bar-row items-center gap-3 rounded-cell text-sm text-secondary hover:bg-hover focus-visible:bg-hover",
        "max-sm:grid-cols-bar-row-compact max-sm:gap-x-3 max-sm:gap-y-1 max-sm:py-1",
        className,
      )}
      {...props}
    >
      <span className="truncate max-sm:col-start-1 max-sm:row-start-1">{label}</span>
      <span className="flex h-2 max-sm:col-span-2 max-sm:row-start-2 max-sm:h-1.5">
        <span
          className={cn(
            "h-full min-w-0.5 rounded-r-sm transition duration-150 ease-soft group-hover:brightness-120",
            fillTones[tone],
          )}
          style={{ width }}
        />
      </span>
      <span className="text-right font-medium text-foreground tabular-nums max-sm:col-start-2 max-sm:row-start-1">
        {value}
      </span>
    </div>
  );
}

const barNote = "ml-1.5 text-muted";

const barShare = "inline-block w-10 text-xs font-normal text-muted";

export interface BarRow {
  label: string;
  value: number;
  highlight?: boolean;
  // Colours the bar like a priority badge instead of the accent.
  tone?: "danger" | "warning" | "success";
  note?: string;
}

export function BarList({ rows, total }: { rows: BarRow[]; total?: number }) {
  const max = Math.max(...rows.map((row) => row.value), 1);

  return (
    <Bars>
      {rows.map((row) => (
        <Bar
          key={row.label}
          data-tip={`${row.label}: ${row.value.toLocaleString("en-US")}`}
          tabIndex={0}
          label={
            <>
              {row.label}
              {row.note && <small className={barNote}>{row.note}</small>}
            </>
          }
          width={`${(row.value / max) * 100}%`}
          tone={row.tone ?? (row.highlight ? "accent" : "neutral")}
          value={
            <>
              {row.value.toLocaleString("en-US")}
              {total !== undefined && (
                <small className={barShare}>{((row.value / total) * 100).toFixed(1)}%</small>
              )}
            </>
          }
        />
      ))}
    </Bars>
  );
}
