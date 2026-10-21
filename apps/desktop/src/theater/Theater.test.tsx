// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider, useI18n } from "../i18n/provider.tsx";
import { Theater, type TheaterProps } from "./Theater.tsx";
import { answeredSession, routeAnswers } from "./test-support.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function fixture() {
  const session = await answeredSession(
    routeAnswers("no_stand", "still", "detour_right", 0.1),
    4,
    2,
  );
  const state = session.state();
  const props: TheaterProps = {
    state,
    kind: "model",
    compassOn: true,
    onCompass: vi.fn(),
    onClose: vi.fn(),
    onPause: vi.fn(),
    pace: "relaxed",
    onPace: vi.fn(),
  };
  const surface = (next: Partial<TheaterProps> = {}) => (
    <LanguageProvider initial={{ preference: "en", detected: "en" }}>
      <Theater {...props} {...next} />
    </LanguageProvider>
  );
  return { session, state, props, surface };
}

describe("visual decision panel", () => {
  it("starts with one action and intent, keeps telemetry in Details and sends explicit controls", async () => {
    const { surface, props, state, session } = await fixture();
    const view = render(surface());
    expect(view.getByRole("tab", { name: "Now" }).getAttribute("aria-selected")).toBe("true");
    expect(view.container.querySelectorAll(".decision-scene")).toHaveLength(1);
    expect(view.container.querySelector(".decision-intent")?.textContent).toContain("Detour right");
    expect(view.container.querySelector(".stats, .inspector, .question-result")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Pause game" }));
    fireEvent.change(view.getByRole("combobox"), { target: { value: "slow" } });
    fireEvent.click(view.getByRole("button", { name: "Hide decisions (T)" }));
    expect(props.onPause).toHaveBeenCalledOnce();
    expect(props.onPace).toHaveBeenCalledWith("slow");
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(session.state()).toEqual(state);
    fireEvent.click(view.getByRole("button", { name: "Technical details" }));
    expect(view.container.querySelector(".stats")).not.toBeNull();
    expect(view.container.querySelectorAll("section.question-result")).toHaveLength(4);
    fireEvent.click(view.getByRole("button", { name: "Compass (C)" }));
    expect(props.onCompass).toHaveBeenCalledOnce();
  });

  it("shows a held answer as ready, with no actual move", async () => {
    const { surface, state } = await fixture();
    const original = state.turns[0];
    if (!original) throw new Error("Missing turn");
    const held = {
      ...state,
      phase: "reading" as const,
      last: original.model,
      lastModel: original.model,
      turns: [{ ...original, steps: [] }],
    };
    const view = render(surface({ state: held }));
    expect(view.getByText("Ready to move")).toBeTruthy();
    expect(view.container.querySelector(".decision-scene")?.getAttribute("data-actual")).toBeNull();
    view.rerender(surface({ state: { ...held, phase: "hopping" } }));
    expect(view.container.querySelector(".decision-scene")?.getAttribute("data-actual")).toBe(
      original.model.action,
    );
  });

  it("keeps a held answer out of sent actions, including while pinned", async () => {
    const { surface, state } = await fixture();
    const original = state.turns[0];
    if (!original) throw new Error("Missing turn");
    const held = {
      ...state,
      phase: "reading" as const,
      last: original.model,
      lastModel: original.model,
      turns: [{ ...original, steps: [] }],
    };
    const view = render(surface({ state: held }));
    fireEvent.click(view.getByRole("tab", { name: "History" }));
    fireEvent.click(
      view.container.querySelector(`[data-decision="${original.model.index}"]`) as HTMLElement,
    );
    expect(view.container.querySelectorAll(".decision-step-list li")).toHaveLength(0);
    fireEvent.click(view.getByRole("button", { name: "Technical details" }));
    expect(view.getByRole("button", { name: "What the model read (I)" })).toBeTruthy();
    view.rerender(surface({ state: { ...held, phase: "hopping" } }));
    expect(view.container.querySelectorAll(".decision-step-list li")).toHaveLength(0);
    fireEvent.click(view.getByRole("button", { name: /Back to live/ }));
    fireEvent.click(view.getByRole("tab", { name: "History" }));
    fireEvent.click(
      view.container.querySelector(`[data-decision="${original.model.index}"]`) as HTMLElement,
    );
    expect(view.getByRole("heading", { name: "Actions sent to the game" })).toBeTruthy();
    expect(view.container.querySelectorAll(".decision-step-list li")).toHaveLength(1);
  });

  it("pins a historical consultation and copies it after the live buffer moves on", async () => {
    const { surface, state } = await fixture();
    const original = state.turns[0];
    if (!original?.model.decision.sent) throw new Error("Missing request");
    const older = {
      ...original,
      model: {
        ...original.model,
        decision: {
          ...original.model.decision,
          sent: { ...original.model.decision.sent, state: { marker: "older request" } },
        },
      },
    };
    const newer = {
      model: {
        ...original.model,
        index: 100,
        decision: {
          ...original.model.decision,
          sent: { ...original.model.decision.sent, state: { marker: "newer request" } },
        },
      },
      steps: [],
    };
    const initial = {
      ...state,
      turns: [older, newer],
      decisions: 101,
      last: newer.model,
      lastModel: newer.model,
    };
    const copy = vi.fn(async (_text: string) => {});
    vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
    const view = render(surface({ state: initial }));
    fireEvent.click(view.getByRole("tab", { name: "History" }));
    const old = view.container.querySelector<HTMLButtonElement>(
      `[data-decision="${older.model.index}"]`,
    );
    if (!old) throw new Error("Missing history row");
    fireEvent.click(old);
    expect(view.getByText("Pinned")).toBeTruthy();
    expect(view.getByRole("tab", { name: "History" }).getAttribute("aria-selected")).toBe("true");
    view.rerender(surface({ state: { ...initial, turns: [newer], decisions: 102 } }));
    fireEvent.click(view.getByRole("button", { name: "Technical details" }));
    fireEvent.click(view.getByRole("button", { name: "What the model read (I)" }));
    expect(view.container.querySelector(".inspector-pre")?.textContent).toContain("older request");
    fireEvent.click(view.getByRole("button", { name: "Copy", exact: true }));
    await waitFor(() => expect(copy).toHaveBeenCalledOnce());
    expect(JSON.parse(copy.mock.calls[0]?.[0] ?? "{}").state.marker).toBe("older request");
    const content = view.container.querySelector<HTMLElement>(".decision-content");
    if (content) content.scrollTop = 500;
    fireEvent.click(view.getByRole("button", { name: /Back to live/ }));
    expect(view.container.querySelector(".decision-content")?.scrollTop).toBe(0);
    expect(view.container.querySelector(".inspector")).toBeNull();
    expect(view.container.querySelector(".decision-context")?.textContent).toContain(
      "Decision 101",
    );
  });

  it("lets scrolling and keyboard navigation leave the game unchanged", async () => {
    const { surface, props } = await fixture();
    const view = render(surface());
    fireEvent.scroll(view.container.querySelector(".decision-content") as HTMLElement);
    expect(view.queryByText("Pinned")).toBeNull();
    fireEvent.keyDown(view.getByRole("tab", { name: "Now" }), { key: "ArrowRight" });
    expect(view.getByRole("tab", { name: "History" }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(view.getByRole("tab", { name: "History" }));
    expect(props.onPause).not.toHaveBeenCalled();
  });

  it("retains an early I request in one game and cancels it across retries", async () => {
    const { surface, state } = await fixture();
    const view = render(
      surface({ state: { ...state, turns: [], decisions: 0 }, inspectVersion: 1 }),
    );
    view.rerender(surface({ inspectVersion: 1 }));
    await waitFor(() => expect(view.container.querySelector(".inspector")).not.toBeNull());
    const next = { ...state, episode: state.episode + 1, turns: [], decisions: 0 };
    view.rerender(surface({ state: next, inspectVersion: 2 }));
    view.rerender(
      surface({
        state: { ...state, episode: next.episode + 1, turns: [], decisions: 0 },
        inspectVersion: 2,
      }),
    );
    view.rerender(surface({ state: { ...state, episode: next.episode + 1 }, inspectVersion: 2 }));
    await waitFor(() => expect(view.container.querySelector(".inspector")).toBeNull());
    expect(view.queryByText("Pinned")).toBeNull();
  });

  it("does not freeze empty technical details before the first answer arrives", async () => {
    const { surface, state } = await fixture();
    const view = render(
      surface({ state: { ...state, turns: [], last: null, lastModel: null, decisions: 0 } }),
    );
    fireEvent.click(view.getByRole("button", { name: "Technical details" }));
    expect(view.queryByText("Pinned")).toBeNull();
    view.rerender(surface({ state }));
    await waitFor(() => expect(view.getByText("Pinned")).toBeTruthy());
    expect(view.getByRole("button", { name: "What the model read (I)" })).toBeTruthy();
  });

  it("retranslates pinned data and preserves original model input", async () => {
    const { props } = await fixture();
    const Switch = () => {
      const { select } = useI18n();
      return (
        <button type="button" onClick={() => select("pt-BR")}>
          language
        </button>
      );
    };
    const view = render(
      <LanguageProvider initial={{ preference: "en", detected: "en" }}>
        <Switch />
        <Theater {...props} inspectVersion={1} />
      </LanguageProvider>,
    );
    await waitFor(() => expect(view.container.querySelector(".inspector")).not.toBeNull());
    const input = view.container.querySelector(".inspector-pre")?.textContent;
    fireEvent.click(view.getByRole("button", { name: "language" }));
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Detalhes técnicos" })).toBeTruthy(),
    );
    expect(view.container.querySelector(".inspector-pre")?.textContent).toBe(input);
    expect(view.getByText("Leitura fixada")).toBeTruthy();
  });
});

it("expands history in place, keeps one consultation open and refreshes only on request", async () => {
  const { surface, state } = await fixture();
  const first = state.turns[0];
  if (!first) throw new Error("Missing turn");
  const next = { model: { ...first.model, index: 100 }, steps: [] };
  const initial = { ...state, turns: [first, next], lastModel: next.model, last: next.model };
  const view = render(surface({ state: initial }));
  fireEvent.click(view.getByRole("tab", { name: "History" }));
  const content = view.container.querySelector<HTMLElement>(".decision-content");
  if (!content) throw new Error("Missing scroll surface");
  content.scrollTop = 125;
  fireEvent.click(
    view.container.querySelector(`[data-decision="${first.model.index}"]`) as HTMLElement,
  );
  expect(content.scrollTop).toBe(125);
  expect(view.getByRole("tab", { name: "History" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.click(view.container.querySelector('[data-decision="100"]') as HTMLElement);
  expect(
    view.container.querySelectorAll('.decision-history-item[aria-expanded="true"]'),
  ).toHaveLength(1);
  const newest = { model: { ...first.model, index: 200 }, steps: [] };
  view.rerender(
    surface({
      state: { ...initial, turns: [next, newest], lastModel: newest.model, last: newest.model },
    }),
  );
  expect(view.container.querySelector('[data-decision="200"]')).toBeNull();
  expect(view.getByRole("status").textContent).toBe("New consultations available");
  fireEvent.click(view.getByRole("button", { name: "Refresh history" }));
  expect(view.container.querySelector('[data-decision="200"]')).not.toBeNull();
  expect(view.container.querySelector('[data-decision="100"]')?.getAttribute("aria-expanded")).toBe(
    "true",
  );
  fireEvent.click(view.getByRole("tab", { name: "Now" }));
  expect(view.queryByText("Pinned")).toBeNull();
});

it("announces an expired selection rather than displaying another consultation's details", async () => {
  const { surface, state } = await fixture();
  const first = state.turns[0];
  if (!first) throw new Error("Missing turn");
  const view = render(surface());
  fireEvent.click(view.getByRole("tab", { name: "History" }));
  fireEvent.click(view.container.querySelector("[data-decision]") as HTMLElement);
  fireEvent.click(view.getByRole("button", { name: "Technical details" }));
  const next = { model: { ...first.model, index: 200 }, steps: [] };
  view.rerender(
    surface({ state: { ...state, turns: [next], lastModel: next.model, last: next.model } }),
  );
  fireEvent.click(view.getByRole("button", { name: "Refresh history" }));
  expect(view.getByRole("status").textContent).toBe(
    "That consultation is no longer in recent history.",
  );
  expect(
    view.container.querySelector(
      ".history-expanded:not([hidden]), .decision-details-view, .inspector",
    ),
  ).toBeNull();
});

it("uses game artwork for the recorded action and keeps artwork failures readable", async () => {
  const { surface, state } = await fixture();
  const artwork = {
    hop_forward: "data:image/png;base64,forward",
    hop_back: "data:image/png;base64,back",
    hop_left: "data:image/png;base64,left",
    hop_right: "data:image/png;base64,right",
  };
  const view = render(surface({ artwork }));
  const action = state.last?.action;
  if (!action || action === "stay") throw new Error("Fixture must be moving");
  expect(view.container.querySelector("image.board-chicken")?.getAttribute("href")).toBe(
    artwork[action],
  );
  view.rerender(surface({ artwork: null }));
  expect(view.getByText("Character preview unavailable")).toBeTruthy();
  expect(view.container.querySelector("canvas.game")).toBeNull();
});

it("keeps inspector focus visible instead of resetting its scroll when I changes tabs", async () => {
  const { surface } = await fixture();
  const view = render(surface());
  const content = view.container.querySelector<HTMLElement>(".decision-content");
  if (!content) throw new Error("Missing content");
  content.scrollTop = 120;
  view.rerender(surface({ inspectVersion: 1 }));
  await waitFor(() => expect(view.container.querySelector(".inspector")).not.toBeNull());
  expect(document.activeElement).toBe(
    view.container.querySelector('[data-action="close-inspector"]'),
  );
  expect(content.scrollTop).toBe(120);
});

it("keeps disclosure relationships valid while their content is collapsed", async () => {
  const { surface } = await fixture();
  const view = render(surface());
  const validTargets = () => {
    for (const button of view.container.querySelectorAll("[aria-controls]")) {
      expect(document.getElementById(button.getAttribute("aria-controls") ?? "")).not.toBeNull();
    }
  };
  validTargets();
  fireEvent.click(view.getByRole("tab", { name: "History" }));
  validTargets();
  fireEvent.click(view.container.querySelector("[data-decision]") as HTMLElement);
  validTargets();
});

it("returns keyboard focus to the inspection button when the inspector closes", async () => {
  const { surface } = await fixture();
  const view = render(surface({ inspectVersion: 1 }));
  await waitFor(() => expect(view.container.querySelector(".inspector")).not.toBeNull());
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(view.container.querySelector(".inspector")).toBeNull());
  expect(document.activeElement).toBe(
    view.getByRole("button", { name: "What the model read (I)" }),
  );
});
