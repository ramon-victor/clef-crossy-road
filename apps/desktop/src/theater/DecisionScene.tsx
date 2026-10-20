import type { Action } from "@ccr/core";
import type { ChickenArtwork } from "@ccr/render";
import { useI18n } from "../i18n/provider.tsx";
import type { DecisionPresentation } from "./presentation.ts";

const ENDS: Record<Action, [number, number]> = {
  hop_forward: [216, 57],
  hop_back: [104, 113],
  hop_left: [104, 57],
  hop_right: [216, 113],
  stay: [160, 85],
};
const TILES = Array.from({ length: 9 }, (_, i) => {
  const row = Math.floor(i / 3) - 1;
  const col = (i % 3) - 1;
  return { row, col, x: 160 + (col - row) * 35, y: 94 + (col + row) * 18 };
}).sort((a, b) => a.y - b.y);

/** An intentionally schematic board: the arrow is a maneuver, never an invented safe route. */
export function DecisionScene({
  view,
  artwork,
}: {
  view: DecisionPresentation;
  artwork: ChickenArtwork | null | undefined;
}) {
  const { t } = useI18n();
  const end = view.intent ? ENDS[view.intent] : null;
  const facing =
    view.actual && view.actual !== "stay"
      ? view.actual
      : view.intent && view.intent !== "stay"
        ? view.intent
        : "hop_forward";
  return (
    <figure
      class="decision-scene"
      data-stage={view.stage}
      data-intent={view.intent}
      data-actual={view.actual}
    >
      <svg viewBox="0 0 320 172" role="img" aria-label={t("decisions.diagram")}>
        <title>{t("decisions.diagram")}</title>
        <ellipse cx="160" cy="139" rx="104" ry="13" class="board-shadow" />
        {TILES.map(({ row, col, x, y }) => (
          <g key={`${row}:${col}`} transform={`translate(${x} ${y})`}>
            <path d="M-34 0 0 18 0 27 -34 9Z" class="tile-left" />
            <path d="M0 18 34 0 34 9 0 27Z" class="tile-right" />
            <path
              d="M-34 0 0-18 34 0 0 18Z"
              class={`tile-top ${row === 0 && col === 0 ? "tile-home" : ""}`}
            />
          </g>
        ))}
        {end && view.intent !== "stay" && (
          <g class="intent-path" key={view.intent}>
            <path d={`M160 85 L${end[0]} ${end[1]}`} />
            <circle cx={end[0]} cy={end[1]} r="9" />
            <path
              d="M-4-4 0 0-4 4"
              transform={`translate(${end[0]} ${end[1]}) rotate(${(Math.atan2(end[1] - 85, end[0] - 160) * 180) / Math.PI})`}
              class="intent-tip"
            />
          </g>
        )}
        <ellipse cx="160" cy="102" rx="19" ry="7" class="board-shadow" />
        {artwork && (
          <image
            class="board-chicken"
            href={artwork[facing]}
            x="102"
            y="4"
            width="116"
            height="116"
          />
        )}
        {(view.actual === "stay" || view.stage === "holding") && (
          <g class="board-wait" transform="translate(206 115)">
            <circle r="16" />
            <path d="M-6-6h4V6h-4Zm8 0h4V6H2Z" />
          </g>
        )}
        {view.actual && view.actual !== "stay" && view.stage === "acting" && (
          <g
            class="actual-mark"
            transform={`translate(${ENDS[view.actual][0]} ${ENDS[view.actual][1]})`}
          >
            <circle r="14" />
            <path
              d="M-6 0H6M2-4l4 4-4 4"
              transform={`rotate(${(Math.atan2(ENDS[view.actual][1] - 85, ENDS[view.actual][0] - 160) * 180) / Math.PI})`}
            />
          </g>
        )}
      </svg>
      <figcaption>
        {t(
          artwork
            ? "decisions.diagram"
            : artwork === null
              ? "decisions.artUnavailable"
              : "decisions.artLoading",
        )}
      </figcaption>
    </figure>
  );
}
