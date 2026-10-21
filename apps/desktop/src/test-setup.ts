import { afterAll, vi } from "vitest";

// Preact runs effects after the next frame, or after 35 ms when no frame comes (RAF_TIMEOUT in
// preact/hooks). A timer still pending when Vitest closes jsdom then calls a cancelAnimationFrame
// that no longer exists and fails the whole run, so every jsdom file waits it out first.
afterAll(async () => {
  if (typeof window === "undefined") return;
  vi.useRealTimers();
  await new Promise((resolve) => setTimeout(resolve, 50));
});
