import type { DecisionNotice } from "@ccr/agent";
import { describe, expect, it } from "vitest";
import { buildPolicyChoices } from "../policies.ts";
import { LOCALES } from "./locale.ts";
import { gameEndTitle, noticeText, playerText } from "./presentation.ts";
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
  it.each(LOCALES)(
    "renders nested controller explanations and player descriptions in %s",
    (locale) => {
      const translation = translator(locale);
      const text = noticeText(notice, translation);
      expect(text).not.toMatch(/{{|notice\.|maneuver\.|hop_back|detour_left/);
      for (const choice of buildPolicyChoices(null)) {
        const description = playerText(choice, translation);
        expect(description.label).not.toMatch(/player\.|{{/);
        expect(description.detail).not.toMatch(/player\.|{{/);
      }
      expect(
        gameEndTitle({ alive: false, stalled: false, deathCause: "water" }, translation),
      ).not.toBe("");
    },
  );

  it("retranslates a recorded note without changing its structured events", () => {
    const original = JSON.stringify(notice);
    expect(noticeText(notice, translator("en"))).toContain("1 hop remaining");
    expect(noticeText(notice, translator("pt-BR"))).toContain("1 salto restante");
    expect(JSON.stringify(notice)).toBe(original);
  });
});
