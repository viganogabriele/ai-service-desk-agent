import { createFileRoute, redirect } from "@tanstack/react-router";

// The queue is the home page; the overview lives under its own route.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/tickets" });
  },
});
