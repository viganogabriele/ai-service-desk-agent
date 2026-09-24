import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

/** Column spans on the 12-column dashboard grid; every span stacks to full width on narrow screens. */
export const SPAN = {
  3: "col-span-12 sm:col-span-6 lg:col-span-3",
  4: "col-span-12 lg:col-span-4",
  5: "col-span-12 lg:col-span-5",
  6: "col-span-12 lg:col-span-6",
  7: "col-span-12 lg:col-span-7",
  8: "col-span-12 lg:col-span-8",
  12: "col-span-12",
};

export function Grid({
  className,
  as: Element = "div",
  ...props
}: ComponentProps<"div"> & { as?: "div" | "section" }) {
  return <Element className={cn("mb-4 grid grid-cols-12 gap-4", className)} {...props} />;
}

/** Vertical run of cards inside one grid cell. */
export function Stack({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("grid min-w-0 content-start gap-4", className)} {...props} />;
}
