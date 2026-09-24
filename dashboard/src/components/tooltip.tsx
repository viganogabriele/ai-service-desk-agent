import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

// Hovering waits before the first tooltip; moving on to the next target within the window is instant.
const OPEN_DELAY = 450;

const SWITCH_WINDOW = 400;

const EDGE = 8;

const GAP = 6;

interface Tip {
  text: string;
  anchor: DOMRect;
  instant: boolean;
}

/**
 * One shared tooltip for every element with a `data-tip` attribute, replacing the browser's
 * `title` bubble. It follows mouse hover and keyboard focus; touch input never opens it.
 */
export function TooltipLayer() {
  const id = useId();
  const node = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, below: false });

  useEffect(() => {
    let timer = 0;
    let target: HTMLElement | null = null;
    let closedAt = 0;

    const hide = () => {
      window.clearTimeout(timer);

      if (!target) return;

      if (target.getAttribute("aria-describedby") === id)
        target.removeAttribute("aria-describedby");
      target = null;
      closedAt = Date.now();
      setTip(null);
    };

    const open = (element: HTMLElement) => {
      const text = element.dataset.tip;

      if (!text) return;
      target = element;
      const instant = Date.now() - closedAt < SWITCH_WINDOW;

      const show = () => {
        if (target !== element) return;

        if (!element.hasAttribute("aria-describedby")) element.setAttribute("aria-describedby", id);
        setTip({ text, anchor: element.getBoundingClientRect(), instant });
      };

      if (instant) show();
      else timer = window.setTimeout(show, OPEN_DELAY);
    };

    const tipTarget = (from: EventTarget | null) =>
      from instanceof Element ? from.closest<HTMLElement>("[data-tip]") : null;

    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const next = tipTarget(event.target);

      if (next === target) return;
      hide();

      if (next) open(next);
    };

    const onFocusIn = (event: FocusEvent) => {
      const next = tipTarget(event.target);

      if (next !== target) hide();

      if (next && next !== target && next.matches(":focus-visible")) open(next);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };

    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", hide);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", hide, true);

    return () => {
      hide();
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", hide);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", hide, true);
    };
  }, [id]);

  // Centre over the anchor, flip below when there is no room above, and keep inside the viewport.
  useLayoutEffect(() => {
    if (!tip || !node.current) return;
    const { width, height } = node.current.getBoundingClientRect();
    const { anchor } = tip;
    const below = anchor.top - GAP - height < EDGE;
    const centre = anchor.left + anchor.width / 2 - width / 2;

    setPosition({
      left: Math.min(Math.max(EDGE, centre), window.innerWidth - width - EDGE),
      top: below ? anchor.bottom + GAP : anchor.top - GAP - height,
      below,
    });
  }, [tip]);

  if (!tip) return null;

  return (
    <div
      ref={node}
      id={id}
      role="tooltip"
      className="tooltip"
      data-below={position.below || undefined}
      data-instant={tip.instant || undefined}
      style={{ left: position.left, top: position.top }}
    >
      {tip.text}
    </div>
  );
}
