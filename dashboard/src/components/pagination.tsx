import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";
import { useTicketFilters } from "./tickets";
import { Button } from "./ui/button";

export const TICKETS_PER_PAGE = 50;

export function TicketPagination({ total }: { total: number }) {
  const { filters, setFilters } = useTicketFilters();
  const pages = Math.max(1, Math.ceil(total / TICKETS_PER_PAGE));
  const page = Math.min(filters.page, pages);

  if (pages === 1) return null;

  const numbered = [...new Set([1, page - 1, page, page + 1, pages])]
    .filter((number) => number >= 1 && number <= pages)
    .sort((a, b) => a - b);

  const goTo = (number: number) => {
    setFilters({ page: number });
    window.scrollTo({ top: 0 });
  };

  return (
    <nav
      aria-label="Ticket pages"
      className="mt-4 flex flex-wrap items-center justify-between gap-3"
    >
      <p className="text-sm text-muted tabular-nums" aria-live="polite">
        {(page - 1) * TICKETS_PER_PAGE + 1}–{Math.min(page * TICKETS_PER_PAGE, total)} of {total}{" "}
        tickets
      </p>
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          aria-label="Previous page"
          disabled={page === 1}
          onClick={() => goTo(page - 1)}
        >
          <ChevronLeft size={16} />
        </Button>
        {numbered.map((number, index) => (
          <span
            key={number}
            className={cn(
              "flex items-center gap-1",
              number !== 1 && number !== page && number !== pages && "max-sm:hidden",
            )}
          >
            {index > 0 && number > numbered[index - 1] + 1 && (
              <span className="px-1 text-muted" aria-hidden="true">
                …
              </span>
            )}
            <Button
              size="icon"
              aria-label={`Page ${number}`}
              aria-current={page === number ? "page" : undefined}
              variant={page === number ? "primary" : "default"}
              onClick={() => goTo(number)}
            >
              {number}
            </Button>
          </span>
        ))}
        <Button
          size="icon"
          aria-label="Next page"
          disabled={page === pages}
          onClick={() => goTo(page + 1)}
        >
          <ChevronRight size={16} />
        </Button>
      </div>
    </nav>
  );
}
