import { cellsOf, ICON_SIZE, type IconName, iconForGlyph, pathOf } from "./pixel.ts";

const paths = new Map<IconName, { fill: string; edge: string }>();

function pathsOf(icon: IconName) {
  let found = paths.get(icon);
  if (!found) {
    const { fill, edge } = cellsOf(icon);
    found = { fill: pathOf(fill), edge: pathOf(edge) };
    paths.set(icon, found);
  }
  return found;
}

export interface PixelIconProps {
  icon: IconName;
  /** Side in CSS pixels; a multiple of 11 keeps every pixel the same size. */
  size?: number;
  class?: string;
}

/** A pixel-art icon in the colour of the text around it, with a dark edge that keeps it readable. */
export function PixelIcon({ icon, size = 22, class: className }: PixelIconProps) {
  const { fill, edge } = pathsOf(icon);
  return (
    <svg
      class={`px ${className ?? ""}`}
      viewBox={`0 0 ${ICON_SIZE} ${ICON_SIZE}`}
      width={size}
      height={size}
      shape-rendering="crispEdges"
      aria-hidden="true"
    >
      <path d={edge} class="px-edge" />
      <path d={fill} fill="currentColor" />
    </svg>
  );
}

export interface GlyphProps {
  /** A character the app writes a move or an answer with (↑ ← → ↓ • ✓ ✗ ↔ ▪), or any text. */
  glyph: string;
  size?: number;
  class?: string;
}

/**
 * A move or an answer as a pixel icon. Anything that is not one of those characters is shown as the text it is.
 */
export function Glyph({ glyph, size, class: className }: GlyphProps) {
  const icon = iconForGlyph(glyph);
  if (icon === null) return <>{glyph}</>;
  return (
    <PixelIcon
      icon={icon}
      {...(size === undefined ? {} : { size })}
      {...(className === undefined ? {} : { class: className })}
    />
  );
}
