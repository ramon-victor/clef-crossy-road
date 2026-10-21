import { useI18n } from "../i18n/provider.tsx";
import type { CaptionView } from "./caption.ts";
import { Glyph } from "./Glyph.tsx";

export interface CompassCaptionProps {
  view: CaptionView;
  conversationOpen: boolean;
  onConversation(): void;
}

/** A quiet summary; exact counters and the complete execution record live in Details. */
export function CompassCaption({ view, conversationOpen, onConversation }: CompassCaptionProps) {
  const { t } = useI18n();
  return (
    <div class="compass-caption">
      <div class="cap-head">
        <span class={`cap-icon ${view.active ? "active" : ""}`} aria-hidden="true">
          <Glyph glyph={view.glyph} size={22} />
        </span>
        <div class={`cap-main ${view.unaided ? "unaided" : ""}`} role="status" aria-atomic="true">
          {view.by && (
            <>
              <span class={`cap-by ${view.by.who}`}>{view.by.label}</span>{" "}
            </>
          )}
          {view.text}
        </div>
        {!conversationOpen && (
          <button
            type="button"
            class="cap-details"
            title={t("theater.details")}
            onClick={onConversation}
          >
            {t("common.details")}
          </button>
        )}
      </div>
      <div class="cap-choice">{view.context}</div>
      <div class="cap-history" aria-hidden="true">
        <span class="cap-history-label">{t("compass.history")}</span>
        <div class="cap-strip">
          {view.strip.map((chip) => (
            <span key={chip.index} class={`hchip ${chip.big ? "big" : ""}`}>
              <Glyph glyph={chip.glyph} size={16} />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
