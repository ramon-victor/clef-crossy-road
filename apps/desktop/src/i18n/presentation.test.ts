import { DEFAULT_STALL_LIMIT, type DecisionNotice } from "@ccr/agent";
import { describe, expect, it } from "vitest";
import { gameEndTitle, noticeText } from "./presentation.ts";
import { translator } from "./translate.ts";

const notice: DecisionNotice = {
  kind: "model",
  maneuver: "detour_left",
  step: {
    kind: "sequence",
    parts: [
      {
        kind: "refused",
        maneuver: "detour_left",
        reason: { kind: "no_route", side: "left", count: 6 },
      },
      { kind: "escape", action: "hop_back", remaining: 1 },
    ],
  },
};

describe("localized game descriptions", () => {
  it("uses the current stall limit and the localized death cause", () => {
    const state = { alive: true, stalled: true, deathCause: null };
    expect(gameEndTitle(state, translator("en"))).toBe(
      `Stuck: no new row in ${DEFAULT_STALL_LIMIT} decisions`,
    );
    expect(
      gameEndTitle(
        { ...state, alive: false, stalled: false, deathCause: "water" },
        translator("pt-BR"),
      ),
    ).toBe(translator("pt-BR").t("death.water"));
  });

  it("describes platform exit refusals from structured data", () => {
    const event: DecisionNotice = {
      kind: "refused",
      maneuver: "leave_platform",
      reason: { kind: "no_exit", count: 4 },
    };
    expect(noticeText(event, translator("en"))).toBe(
      "get off the platform could not start. No way off within 4 hops.",
    );
    expect(noticeText({ kind: "still_water" }, translator("pt-BR"))).toBe(
      "Nada se move nessa linha; a água continua lá.",
    );
  });

  it("retranslates a recorded note without changing its structured events", () => {
    const original = JSON.stringify(notice);
    expect(noticeText(notice, translator("en"))).toContain("1 hop remaining");
    expect(noticeText(notice, translator("pt-BR"))).toContain("1 salto restante");
    expect(JSON.stringify(notice)).toBe(original);
  });
});
