const PATHS = {
  play: "m8 5 11 7-11 7Z",
  pause: "M8 5v14M16 5v14",
  step: "m5 5 11 7-11 7ZM19 5v14",
  retry: "M4 10a8 8 0 1 1 1 8M4 4v6h6",
  map: "m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3ZM9 3v15M15 6v15",
} as const;

/** Small interface icons share one stroke and never depend on the platform's emoji font. */
export function UiIcon({ name }: { name: keyof typeof PATHS }) {
  return (
    <svg
      class="ui-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
