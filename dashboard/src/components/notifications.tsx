import { useEffect, useRef, useState } from "react";
import { Link, useMatchRoute } from "@tanstack/react-router";
import * as Popover from "@radix-ui/react-popover";
import { Bell, MessageSquareReply, Sparkles } from "lucide-react";
import { useDashboard } from "../state";
import { classifiedSince, isPending, replyNotifications } from "../lib/notifications";
import type { KeyedItem, TicketNotification } from "../lib/notifications";
import { stageOf, timeAgo } from "../lib/queue";
import { cn } from "../lib/utils";
import { PriorityBadge, personName } from "./tickets";
import { popoverClass } from "./select";
import { Button } from "./ui/button";

const STORAGE_KEY = "service-desk-notifications-v1";

// Classifications are events the data does not keep, so the last few are stored with the read marks.
const KEEP = 30;

interface Saved {
  read: string[];
  classified: TicketNotification[];
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    return raw ? { read: [], classified: [], ...JSON.parse(raw) } : { read: [], classified: [] };
  } catch {
    return { read: [], classified: [] };
  }
}

/**
 * The bell in the top bar. It collects reporter replies, which can sit behind higher priorities in
 * the queue, and tickets the AI finished while you waited. A new reply also shows a notice, and the
 * tab title counts what is unread. Opening a ticket marks its notifications read.
 */
export function Notifications({ className }: { className?: string }) {
  const { ticketRows, announce } = useDashboard();
  const [saved, setSaved] = useState(load);
  const [open, setOpen] = useState(false);
  const matchRoute = useMatchRoute();
  const viewing = matchRoute({ to: "/tickets/$ticketId" });
  const viewingKey = viewing ? viewing.ticketId : null;

  const items: KeyedItem[] = ticketRows;

  const replies = replyNotifications(items);
  const known = new Set(items.map((item) => item.id));

  const all = [
    ...replies,
    ...saved.classified
      .filter((notification) => known.has(notification.key))
      .toSorted((a, b) => (b.at ?? 0) - (a.at ?? 0)),
  ];

  const read = new Set(saved.read);
  const unread = all.filter((notification) => !read.has(notification.id));
  const pendingKeys = items.flatMap((item) => (isPending(item) ? [item.id] : [])).join(",");
  const replyIds = replies.map((notification) => notification.id).join(",");
  const [seen, setSeen] = useState({ pendingKeys, replyIds });
  const [fresh, setFresh] = useState<{ message: string } | null>(null);
  const announced = useRef<{ message: string } | null>(null);

  const markRead = (ids: string[]) => {
    // Only marks for notifications that still exist are kept, so the list does not grow forever.
    const live = new Set(all.map((notification) => notification.id));

    setSaved((current) => ({
      ...current,
      read: [...new Set([...current.read, ...ids])].filter((id) => live.has(id)),
    }));
  };

  // Changes since the last render, handled while rendering rather than in an effect. What is there
  // when the page opens waits in the bell; a ticket the AI finishes, or a reply that arrives, now
  // is added, and a reply also shows a notice unless you are on that ticket.
  if (seen.pendingKeys !== pendingKeys || seen.replyIds !== replyIds) {
    const finished = classifiedSince(new Set(seen.pendingKeys.split(",")), items);
    const before = new Set(seen.replyIds.split(","));
    const reply = replies.find((notification) => !before.has(notification.id));
    const item = reply && items.find((entry) => entry.id === reply.key);

    setSeen({ pendingKeys, replyIds });

    if (finished.length)
      setSaved((current) => ({
        ...current,
        classified: [...finished, ...current.classified].slice(0, KEEP),
      }));

    if (reply && item && reply.key !== viewingKey)
      setFresh({
        message: `${personName(item.ticket.Reporter) || "The reporter"} replied on ${reply.key}.`,
      });
  }

  // Opening a ticket reads what it has.
  const viewed = unread.flatMap((notification) =>
    notification.key === viewingKey ? [notification.id] : [],
  );

  if (viewed.length) markRead(viewed);

  useEffect(() => {
    if (!fresh || announced.current === fresh) return;
    announced.current = fresh;
    announce(fresh);
  }, [fresh, announce]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // Without storage, read marks last for this visit only.
    }
  }, [saved]);

  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");

    document.title = unread.length ? `(${unread.length}) ${base}` : base;
  }, [unread.length]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          size="icon"
          className={cn("relative", className)}
          aria-label={unread.length ? `Notifications, ${unread.length} unread` : "Notifications"}
          data-tip={open ? undefined : "Notifications"}
        >
          <Bell size={18} strokeWidth={1.75} />
          {unread.length > 0 && (
            <span
              className="absolute top-1 right-1 grid h-4.5 min-w-4.5 animate-pop-in place-items-center rounded-pill bg-danger px-1 text-2xs font-semibold text-danger-foreground tabular-nums"
              aria-hidden="true"
            >
              {unread.length > 9 ? "9+" : unread.length}
            </span>
          )}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={cn(
            "z-20 flex w-90 max-w-pop origin-(--radix-popover-content-transform-origin) flex-col text-base text-secondary data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in",
            popoverClass,
          )}
          align="end"
          sideOffset={8}
          collisionPadding={12}
        >
          <div className="flex items-center justify-between gap-2 border-b border-divider py-2 pr-2 pl-4">
            <b className="font-display text-md font-semibold text-foreground">Notifications</b>
            <Button
              variant="ghost"
              size="sm"
              disabled={unread.length === 0}
              onClick={() => markRead(unread.map((notification) => notification.id))}
            >
              Mark all read
            </Button>
          </div>
          {all.length ? (
            <ul className="grid max-h-96 overflow-y-auto overscroll-contain p-1.5">
              {all.map((notification) => {
                const item = items.find((entry) => entry.id === notification.key);

                return item ? (
                  <li key={notification.id}>
                    <NotificationRow
                      notification={notification}
                      item={item}
                      unread={!read.has(notification.id)}
                      onOpen={() => {
                        markRead([notification.id]);
                        setOpen(false);
                      }}
                    />
                  </li>
                ) : null;
              })}
            </ul>
          ) : (
            <p className="px-4 py-8 text-center text-muted">You're all caught up.</p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function NotificationRow({
  notification,
  item,
  unread,
  onOpen,
}: {
  notification: TicketNotification;
  item: KeyedItem;
  unread: boolean;
  onOpen: () => void;
}) {
  const reply = notification.kind === "reply";
  const Icon = reply ? MessageSquareReply : Sparkles;

  return (
    <Link
      to="/tickets/$ticketId"
      params={{ ticketId: notification.key }}
      className="grid grid-cols-notification items-start gap-3 rounded-option px-2.5 py-2.5 transition-colors duration-120 ease-soft hover:bg-hover"
      onClick={onOpen}
    >
      <span
        className={cn(
          "mt-0.5 grid size-7 place-items-center rounded-full",
          // The same marks as the cards: inverted for a reply, the AI's blue for a classification.
          reply ? "bg-foreground text-background" : "bg-primary-subtle text-primary-text",
        )}
      >
        <Icon size={14} strokeWidth={2} />
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className={cn("text-sm", unread ? "text-foreground" : "text-secondary")}>
          {reply ? (
            <>
              <b className="font-semibold">{personName(item.ticket.Reporter) || "The reporter"}</b>{" "}
              replied on {notification.key}
            </>
          ) : (
            <>
              <b className="font-semibold">{notification.key}</b>{" "}
              {stageOf(item) === "review" ? "is ready for review" : "was classified"}
            </>
          )}
        </span>
        <span className="line-clamp-2 text-sm text-muted">{notification.text}</span>
        <span className="mt-1 flex items-center gap-2 text-xs text-muted">
          <PriorityBadge triage={item.current.triage} />
          {notification.at !== null && <span>{timeAgo(notification.at)}</span>}
        </span>
      </span>
      <span
        className={cn("mt-2 size-2 rounded-full", unread ? "bg-primary" : "bg-transparent")}
        aria-label={unread ? "Unread" : undefined}
      />
    </Link>
  );
}
