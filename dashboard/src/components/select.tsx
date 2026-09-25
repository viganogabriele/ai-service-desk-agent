import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "../lib/utils";
import { focusRing } from "./ui/form";

// Shared with the value picker in the classification sidebar.
export const optionClass =
  "flex min-h-8.5 cursor-pointer items-center gap-2 rounded-option px-2.5 py-1 text-base font-normal text-foreground aria-selected:text-primary-text pointer-coarse:min-h-10 [&_svg]:text-primary-text";

export const optionHintClass = "text-sm whitespace-nowrap text-muted";

export const optionGroupClass =
  "block px-2 pt-2 pb-1 text-xs font-semibold tracking-group text-muted uppercase";

export const optionSearchClass =
  "flex items-center gap-2 border-b border-divider px-3 py-2.5 text-sm text-muted";

export const optionSearchInputClass =
  "min-w-0 flex-1 bg-transparent font-normal text-foreground outline-none pointer-coarse:text-lg";

export const optionEmptyClass = "px-2 py-2.5 text-muted";

export const popoverClass = "rounded-tile bg-tooltip shadow-popover";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
  group?: string;
  icon?: ReactNode;
}

interface SelectProps<T extends string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  label: string;
  // Hides the visible label; the listbox keeps it as its accessible name.
  hideLabel?: boolean;
  searchable?: boolean;
  disabled?: boolean;
  className?: string;
}

/** Listbox select with keyboard support: arrows, Home/End, Enter/Space, Escape, type-ahead. */
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  hideLabel = false,
  searchable = options.length > 10,
  disabled = false,
  className,
}: SelectProps<T>) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [upward, setUpward] = useState(false);
  const typed = useRef({ text: "", at: 0 });
  const needle = query.trim().toLowerCase();

  const shown = needle
    ? options.filter((option) =>
        `${option.label} ${option.hint ?? ""}`.toLowerCase().includes(needle),
      )
    : options;

  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;

    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };

    document.addEventListener("pointerdown", onPointer);

    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const box = trigger.current?.getBoundingClientRect();

    if (box) setUpward(window.innerHeight - box.bottom < 300 && box.top > 300);
  }, [open]);

  useEffect(() => {
    if (open)
      list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function show() {
    if (disabled) return;
    setQuery("");
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
    setOpen(true);
  }

  function choose(option: SelectOption<T> | undefined) {
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    trigger.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        show();
      }

      return;
    }

    const last = shown.length - 1;

    if (event.key === "ArrowDown") setActive((current) => Math.min(last, current + 1));
    else if (event.key === "ArrowUp") setActive((current) => Math.max(0, current - 1));
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(last);
    else if (event.key === "Enter" || (event.key === " " && !searchable)) choose(shown[active]);
    else if (event.key === "Escape") {
      setOpen(false);
      trigger.current?.focus();
    } else if (event.key === "Tab") setOpen(false);
    else if (!searchable && event.key.length === 1) {
      const now = Date.now();
      typed.current = {
        text: (now - typed.current.at < 600 ? typed.current.text : "") + event.key.toLowerCase(),
        at: now,
      };

      const match = shown.findIndex((option) =>
        option.label.toLowerCase().startsWith(typed.current.text),
      );

      if (match >= 0) setActive(match);

      return;
    } else return;

    event.preventDefault();
  }

  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-col gap-2 text-sm font-medium text-secondary",
        className,
      )}
      ref={root}
    >
      <span className={hideLabel ? "sr-only" : undefined} id={`${id}-label`}>
        {label}
      </span>
      <button
        ref={trigger}
        type="button"
        className={cn(
          "group/trigger flex h-10 w-full items-center justify-between gap-2 rounded-pill border bg-surface pr-3 pl-3.5 text-left text-base font-medium text-foreground transition duration-120 ease-out hover:border-border-hover disabled:cursor-not-allowed disabled:opacity-50 aria-expanded:border-ring aria-expanded:ring-3 aria-expanded:ring-primary-subtle pointer-coarse:h-10.5",
          focusRing,
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open && !searchable && shown[active] ? `${id}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        <span
          className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap [&>span]:truncate"
          id={`${id}-value`}
        >
          {selected?.icon}
          <span>{selected?.label ?? "Select…"}</span>
        </span>
        <ChevronDown
          size={16}
          strokeWidth={1.75}
          className="text-muted transition-transform duration-120 ease-out group-aria-expanded/trigger:rotate-180"
        />
      </button>
      {open && (
        <div
          className={cn(
            "absolute left-0 z-20 flex max-h-80 w-max max-w-popover min-w-full animate-pop-in flex-col",
            popoverClass,
            upward ? "bottom-full mb-1.5 origin-bottom-left" : "top-full mt-1.5 origin-top-left",
          )}
        >
          {searchable && (
            <label className={optionSearchClass}>
              <Search size={14} strokeWidth={1.75} />
              <span className="sr-only">Filter options</span>
              <input
                autoFocus
                className={optionSearchInputClass}
                value={query}
                placeholder="Search…"
                aria-controls={`${id}-list`}
                aria-activedescendant={shown[active] ? `${id}-${active}` : undefined}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
              />
            </label>
          )}
          <ul
            ref={list}
            id={`${id}-list`}
            role="listbox"
            aria-labelledby={`${id}-label`}
            tabIndex={-1}
            className="list-none overflow-y-auto p-1"
          >
            {shown.map((option, index) => (
              <li key={option.value} role="presentation">
                {option.group && option.group !== shown[index - 1]?.group && (
                  <span className={optionGroupClass}>{option.group}</span>
                )}
                <div
                  id={`${id}-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={option.value === value}
                  className={cn(optionClass, index === active && "bg-active")}
                  onPointerEnter={() => setActive(index)}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                >
                  {option.icon}
                  <span className="flex min-w-0 flex-1 items-baseline justify-between gap-4">
                    {option.label}
                    {option.hint && <small className={optionHintClass}>{option.hint}</small>}
                  </span>
                  {option.value === value && <Check size={14} strokeWidth={2} />}
                </div>
              </li>
            ))}
            {shown.length === 0 && <li className={optionEmptyClass}>No matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
