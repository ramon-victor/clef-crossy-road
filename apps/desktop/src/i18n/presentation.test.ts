import { DEFAULT_STALL_LIMIT, type DecisionNotice } from "@ccr/agent";
import { describe, expect, it } from "vitest";
import { LOCALES } from "./locale.ts";
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

describe("noticeText: every kind of notice, in every language", () => {
  const leaf: DecisionNotice = { kind: "waited" };
  // One of each kind: the type makes a new kind fail to compile here until it has an example.
  const examples: Record<DecisionNotice["kind"], DecisionNotice> = {
    wait: { kind: "wait" },
    safe_wait: { kind: "safe_wait" },
    exposed_wait: { kind: "exposed_wait" },
    edge_wait: { kind: "edge_wait" },
    waiting_gap: { kind: "waiting_gap" },
    drift: { kind: "drift" },
    waited: leaf,
    still_water: { kind: "still_water" },
    not_carried: { kind: "not_carried" },
    clear: { kind: "clear", maneuver: "cross_ahead" },
    go: { kind: "go", maneuver: "cross_ahead" },
    waiting: { kind: "waiting", maneuver: "cross_ahead", cell: "vehicle", waited: 2, limit: 15 },
    escape: { kind: "escape", action: "hop_back", remaining: 1 },
    detour: { kind: "detour", maneuver: "detour_left", step: 1, action: "hop_left", remaining: 2 },
    permanent: { kind: "permanent", cell: "tree" },
    cannot_stay: { kind: "cannot_stay", cell: "vehicle" },
    not_exposed: { kind: "not_exposed", cell: "empty" },
    timeout: { kind: "timeout", cell: "water", count: 15 },
    too_long: { kind: "too_long", count: 40 },
    still_carried: { kind: "still_carried", count: 8 },
    no_exit: { kind: "no_exit", count: 4 },
    no_route: { kind: "no_route", side: "left", count: 24 },
    refused: {
      kind: "refused",
      maneuver: "step_off",
      reason: { kind: "not_exposed", cell: "empty" },
    },
    returned: { kind: "returned", maneuver: "cross_ahead", reason: leaf },
    hopped: { kind: "hopped", maneuver: "cross_ahead", count: 3 },
    reached: { kind: "reached", maneuver: "detour_left", count: 5 },
    sequence: { kind: "sequence", parts: [leaf, { kind: "go", maneuver: "cross_ahead" }] },
    model: { kind: "model", maneuver: "wait_gap", step: { kind: "waiting_gap" } },
  };

  it.each(LOCALES)("%s has no raw placeholder and no missing key in any notice", (locale) => {
    for (const [kind, example] of Object.entries(examples)) {
      const text = noticeText(example, translator(locale));
      expect(text, `${locale} / ${kind}`).not.toMatch(/\{\{|\}\}/);
      expect(text, `${locale} / ${kind}`).not.toMatch(/^notice\./);
      expect(text.length, `${locale} / ${kind}`).toBeGreaterThan(0);
    }
  });
});
