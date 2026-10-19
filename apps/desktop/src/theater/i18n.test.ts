import { expect, it } from "vitest";
import { LOCALES } from "../i18n/locale.ts";
import { translator } from "../i18n/translate.ts";
import { buildCompass } from "./compass.ts";
import { buildFeed } from "./feed.ts";
import { answeredSession, routeAnswers } from "./test-support.ts";

it("retranslates recorded model turns without changing their input, choices or geometry", async () => {
  const session = await answeredSession(routeAnswers("no_stand", "still", "detour_right"), 4, 2);
  const state = session.state();
  const before = JSON.stringify(state);
  const english = buildFeed(state);
  const compass = buildCompass(state);
  const titles = new Set<string>();
  for (const locale of LOCALES) {
    const translation = translator(locale);
    const feed = buildFeed(state, translation);
    const view = buildCompass(state, translation);
    const last = feed.at(-1);
    titles.add(last?.questions[0]?.title ?? "");
    expect(last?.questions[0]?.title).toBe(translation.t("route.question.cell"));
    expect(last?.questions[0]?.options.find((option) => option.chosen)?.short).toBe(
      translation.t("route.no_stand.short"),
    );
    expect(
      feed.map((turn) =>
        turn.questions.map((question) => ({
          id: question.id,
          chosen: question.chosen,
          options: question.options.map((option) => ({
            id: option.id,
            p: option.p,
            chosen: option.chosen,
            rule: option.rule,
            glyph: option.glyph,
          })),
        })),
      ),
    ).toEqual(
      english.map((turn) =>
        turn.questions.map((question) => ({
          id: question.id,
          chosen: question.chosen,
          options: question.options.map((option) => ({
            id: option.id,
            p: option.p,
            chosen: option.chosen,
            rule: option.rule,
            glyph: option.glyph,
          })),
        })),
      ),
    );
    expect(view.moves).toEqual(compass.moves);
    expect(view.strip).toEqual(compass.strip);
  }
  expect(titles.size).toBe(LOCALES.length);
  expect(JSON.stringify(state)).toBe(before);
});
