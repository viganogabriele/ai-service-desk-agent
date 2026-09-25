import { useMatchRoute, useSearch } from "@tanstack/react-router";
import type { ComponentProps } from "react";
import { cn } from "../lib/utils";
import { useTicketFilters } from "./tickets";
import { Card } from "./ui/card";

/** A placeholder bar. Give it the width and height of the text or control it stands in for. */
export function Bone({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("block h-3 rounded-sm skeleton", className)} {...props} />;
}

// Summary widths vary from row to row, so the list reads as text rather than a grid of bars.
const WIDTHS = ["w-3/5", "w-4/5", "w-1/2", "w-2/3", "w-3/4", "w-2/5", "w-3/5", "w-1/2"];

/**
 * The page that is loading, drawn in placeholders: the same toolbar, sections and cards in the same
 * places, so nothing moves when the tickets arrive. It fades in only after a moment, so a fast load
 * never flashes it.
 */
export function PageSkeleton() {
  const matchRoute = useMatchRoute();
  const { filters } = useTicketFilters();
  // The URL is read directly: the filters only pick up `?view=` once the ticket page mounts.
  const search: { view?: string } = useSearch({ strict: false });
  const view = search.view ?? filters.view;

  const page = matchRoute({ to: "/overview" }) ? (
    <OverviewSkeleton />
  ) : matchRoute({ to: "/tickets/$ticketId" }) ? (
    <DetailSkeleton />
  ) : view === "table" ? (
    <>
      <ToolbarSkeleton filters={4} />
      <SectionHeadSkeleton />
      <TableSkeleton rows={8} />
    </>
  ) : view === "board" ? (
    <>
      <ToolbarSkeleton filters={3} />
      <SectionHeadSkeleton />
      <BoardSkeleton />
    </>
  ) : (
    <>
      <ToolbarSkeleton filters={3} />
      <PrioritySkeleton />
    </>
  );

  return (
    <div className="animate-skeleton-in" role="status" aria-busy="true">
      <span className="sr-only">Loading tickets…</span>
      <div aria-hidden="true">{page}</div>
    </div>
  );
}

function ToolbarSkeleton({ filters }: { filters: number }) {
  return (
    <div className="mb-8 flex flex-wrap items-center gap-2">
      <span className="flex h-10 w-85 max-w-full items-center gap-2.5 rounded-pill border bg-surface px-3.5 max-sm:w-full">
        <Bone className="size-3.5 rounded-full" />
        <Bone className="h-2.5 w-40" />
      </span>
      <span className="flex flex-wrap gap-2 max-sm:w-full">
        {Array.from({ length: filters }, (_, index) => (
          <span
            key={index}
            className="flex h-10 min-w-37.5 items-center rounded-pill border bg-surface px-3.5 max-sm:min-w-0 max-sm:flex-1"
          >
            <Bone className="h-2.5 w-18" />
          </span>
        ))}
      </span>
      <span className="ml-auto size-10 rounded-pill border bg-surface" />
    </div>
  );
}

function SectionHeadSkeleton({ text = true }: { text?: boolean }) {
  return (
    <div className="mb-4 flex min-h-9 items-center gap-3.5">
      <Bone className="h-5.5 w-40 rounded-control" />
      {text && <Bone className="w-24 max-sm:hidden" />}
    </div>
  );
}

/** Attention needed and Most recent, each a strip of cards, then the whole queue. */
function PrioritySkeleton() {
  return (
    <div className="grid gap-section">
      {[0, 1].map((lane) => (
        <section key={lane} className="min-w-0">
          <SectionHeadSkeleton text={false} />
          <div className="-mx-page flex gap-card-gap overflow-hidden px-page pt-1.5 pb-3">
            {Array.from({ length: 4 }, (_, index) => (
              <TicketCardSkeleton key={index} />
            ))}
          </div>
        </section>
      ))}
      <section className="min-w-0">
        <SectionHeadSkeleton text={false} />
        <TableSkeleton rows={6} />
      </section>
    </div>
  );
}

function TicketCardSkeleton() {
  return (
    <div className="flex flex-none basis-strip-card flex-col gap-4 rounded-card border bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between">
        <Bone className="h-5.5 w-27 rounded-pill" />
        <Bone className="h-5.5 w-20 rounded-pill" />
      </div>
      <div className="grid gap-2">
        <Bone className="h-4.5 w-11/12" />
        <Bone className="h-4.5 w-3/5" />
        <Bone className="mt-1 h-2.5 w-36" />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <span className="grid h-15 content-center gap-2 rounded-tile bg-elevated px-3">
          <Bone className="h-2 w-12" />
          <Bone className="w-4/5" />
        </span>
        <span className="grid h-15 content-center gap-2 rounded-tile bg-elevated px-3">
          <Bone className="h-2 w-16" />
          <Bone className="w-3/4" />
        </span>
      </div>
      <div className="mt-8 flex items-center justify-between">
        <Bone className="h-9 w-44 rounded-pill" />
        <Bone className="size-9 rounded-pill" />
      </div>
    </div>
  );
}

const CELL = "min-w-0 px-3 first:pl-0";

function TableSkeleton({ rows }: { rows: number }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="grid h-11 grid-cols-queue-skeleton items-center px-card-pad max-md:hidden">
        {["w-14", "w-14", "w-14", "w-16", "w-12"].map((width, index) => (
          <span key={index} className={CELL}>
            <Bone className={cn("h-2.5", width)} />
          </span>
        ))}
      </div>
      {WIDTHS.slice(0, rows).map((width, index) => (
        <div key={index} className="border-t border-divider px-card-pad">
          <div className="grid h-16 grid-cols-queue-skeleton items-center max-md:hidden">
            <span className={cn(CELL, "grid gap-2")}>
              <Bone className={cn("h-3.5 max-w-130", width)} />
              <Bone className="h-2.5 w-44" />
            </span>
            <span className={CELL}>
              <Bone className="h-5.5 w-18 rounded-pill" />
            </span>
            <span className={cn(CELL, "grid gap-2")}>
              <Bone className="w-4/5" />
              <Bone className="h-2.5 w-1/2" />
            </span>
            <span className={cn(CELL, "flex items-center gap-2")}>
              <Bone className="size-6 flex-none rounded-full" />
              <Bone className="w-3/5" />
            </span>
            <span className={CELL}>
              <Bone className="h-6 w-28 rounded-pill" />
            </span>
          </div>
          {/* Below 860px the table stacks each ticket into a small card. */}
          <div className="grid gap-2.5 py-3.5 md:hidden">
            <span className="grid gap-2">
              <Bone className="h-3.5 w-11/12" />
              <Bone className={cn("h-3.5", width)} />
              <Bone className="h-2.5 w-3/5" />
            </span>
            <span className="flex items-center justify-between gap-4">
              <Bone className="w-2/5" />
              <Bone className="h-5.5 w-18 rounded-pill" />
            </span>
            <span className="flex items-center justify-between gap-4">
              <span className="flex w-2/5 items-center gap-2">
                <Bone className="size-6 flex-none rounded-full" />
                <Bone className="w-full" />
              </span>
              <Bone className="h-2.5 w-24" />
            </span>
          </div>
        </div>
      ))}
    </Card>
  );
}

// Cards per column, uneven like a real queue.
const COLUMNS = [3, 2, 2, 1, 2];

function BoardSkeleton() {
  return (
    <div className="grid grid-cols-board gap-card-gap overflow-hidden pb-2 max-md:grid-cols-board-swipe">
      {COLUMNS.map((cards, column) => (
        <div
          key={column}
          className="grid min-h-70 content-start gap-2.5 rounded-card border bg-shell px-3 pb-3"
        >
          <div className="flex items-center justify-between px-1.5 pt-4 pb-2">
            <Bone className="w-24" />
            <Bone className="h-5 w-6 rounded-pill" />
          </div>
          {Array.from({ length: cards }, (_, index) => (
            <div key={index} className="grid gap-3 rounded-tile border bg-surface p-3.5">
              <div className="flex items-center justify-between">
                <Bone className="h-5.5 w-18 rounded-pill" />
                <Bone className="h-2.5 w-12" />
              </div>
              <div className="grid gap-1.5">
                <Bone className="w-11/12" />
                <Bone className={WIDTHS[column + index]} />
              </div>
              <Bone className="h-2.5 w-1/2" />
              <div className="flex items-center gap-2 border-t border-divider pt-2.5">
                <Bone className="size-6 rounded-full" />
                <Bone className="h-2.5 w-20" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** A numbered step heading inside a card: the blue step number, a title and one line under it. */
function StepHeadSkeleton({ note = true }: { note?: boolean }) {
  return (
    <div className="flex items-center gap-3.5 border-b border-divider px-card-pad py-4.5">
      <Bone className="size-7 rounded-full" />
      <span className="grid gap-2">
        <Bone className="h-4 w-28" />
        {note && <Bone className="h-2.5 w-36" />}
      </span>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="grid min-w-0 grid-cols-workspace items-start gap-x-7 gap-y-5 max-xl:grid-cols-workspace-compact max-lg:grid-cols-1">
      <div className="col-span-full mt-2 mb-1 flex h-6 items-center gap-3">
        <Bone className="ml-2.5 h-3 w-20" />
        <Bone className="h-2.5 w-12" />
        <Bone className="ml-auto size-9 rounded-pill" />
        <Bone className="size-9 rounded-pill" />
      </div>
      <div className="grid min-w-0 gap-5">
        <div className="grid gap-3 pt-1 pb-2">
          <div className="flex items-center gap-2.5">
            <Bone className="h-5.5 w-17 rounded-pill" />
            <Bone className="h-6 w-28 rounded-pill max-sm:hidden" />
            <Bone className="w-56 max-sm:w-24" />
          </div>
          <Bone className="my-1 h-6.5 w-3/5 max-md:w-full" />
          <div className="grid grid-cols-tiles-wide gap-2.5">
            {["w-3/5", "w-1/2", "w-1/3"].map((width, index) => (
              <span
                key={index}
                className="grid h-15 content-center gap-2 rounded-tile bg-elevated px-3"
              >
                <Bone className="h-2 w-18" />
                <Bone className={width} />
              </span>
            ))}
          </div>
        </div>
        <Card className="p-0">
          <div className="grid gap-3 p-card-pad">
            {["w-full", "w-11/12", "w-2/5"].map((width, index) => (
              <Bone key={index} className={cn("my-1", width)} />
            ))}
          </div>
          {["w-24", "w-20"].map((width) => (
            <div
              key={width}
              className="flex h-12 items-center gap-2.5 border-t border-divider px-card-pad"
            >
              <Bone className="size-4 rounded-full" />
              <Bone className={width} />
            </div>
          ))}
        </Card>
        <Card className="p-0">
          <StepHeadSkeleton note={false} />
          <div className="grid grid-cols-3 gap-2.5 p-card-pad max-md:grid-cols-1">
            {Array.from({ length: 3 }, (_, index) => (
              <span key={index} className="grid h-28 content-center gap-3 rounded-tile border px-4">
                <Bone className="h-3.5 w-24" />
                <Bone className="h-2.5 w-4/5" />
              </span>
            ))}
          </div>
        </Card>
      </div>
      <Card className="p-0 lg:sticky lg:top-23">
        <StepHeadSkeleton />
        <div className="grid px-card-pad pt-4 pb-card-pad">
          {["w-1/2", "w-3/5", "w-1/2", "w-2/5", "w-1/3", "w-1/3", "w-1/4"].map((width, index) => (
            <div
              key={index}
              className="grid h-11.5 grid-cols-class-row items-center gap-3 border-t border-divider first:border-t-0"
            >
              <Bone className="h-2.5 w-14" />
              <span className="flex h-8 items-center rounded-control border px-3">
                <Bone className={cn("h-2.5", width)} />
              </span>
            </div>
          ))}
          <Bone className="mt-4 h-9 rounded-pill" />
        </div>
      </Card>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-card-gap">
      <div className="flex min-h-9 items-center gap-3.5">
        <Bone className="h-5.5 w-28 rounded-control" />
        <Bone className="w-100 max-md:hidden" />
      </div>
      <div className="grid grid-cols-4 gap-card-gap max-lg:grid-cols-2">
        {["w-3/5", "w-1/2", "w-4/5", "w-3/4"].map((width, index) => (
          <Card key={index} className="flex flex-col gap-1">
            <Bone className={cn("my-0.5", width)} />
            <Bone className="mt-4 mb-1.5 h-7 w-24" />
            <Bone className="my-0.5 h-2.5 w-3/5" />
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-12 gap-card-gap">
        <Card className="col-span-8 grid gap-4 max-lg:col-span-12">
          <div className="grid gap-2">
            <Bone className="h-3.5 w-36" />
            <Bone className="h-2.5 w-64 max-sm:w-full" />
          </div>
          <Bone className="h-56 rounded-control" />
          <div className="grid grid-cols-3 gap-4 border-t border-divider pt-3.5">
            {Array.from({ length: 3 }, (_, index) => (
              <span key={index} className="grid gap-2">
                <Bone className="h-2.5 w-20" />
                <Bone className="h-4 w-14" />
              </span>
            ))}
          </div>
        </Card>
        <Card className="col-span-4 grid content-start gap-4 max-lg:col-span-12">
          <div className="mb-3 grid gap-2">
            <Bone className="h-3.5 w-32" />
            <Bone className="h-2.5 w-3/4" />
          </div>
          {["w-full", "w-full", "w-11/12", "w-11/12", "w-1/2", "w-1/4"].map((width, index) => (
            <div key={index} className="grid grid-cols-bar-row-compact items-center gap-4">
              <span className="grid grid-cols-2 items-center gap-4">
                <Bone className="h-2.5 w-4/5" />
                <Bone className={cn("h-2 rounded-xs", width)} />
              </span>
              <Bone className="h-2.5 w-14" />
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
