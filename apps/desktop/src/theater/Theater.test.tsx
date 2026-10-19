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
    fireEvent.click(view.getByRole("tab", { name: "Details" }));
    expect(view.container.querySelector(".stats")).not.toBeNull();
    expect(view.container.querySelectorAll("section.question-result")).toHaveLength(3);
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
    fireEvent.click(view.getByRole("tab", { name: "Details" }));
    expect(view.queryByRole("heading", { name: "Actions sent to the game" })).toBeNull();
    expect(view.getByRole("button", { name: "What the model read (I)" })).toBeTruthy();
    view.rerender(surface({ state: { ...held, phase: "hopping" } }));
    expect(view.queryByRole("heading", { name: "Actions sent to the game" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: /Back to live/ }));
    fireEvent.click(view.getByRole("tab", { name: "Details" }));
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
    expect(view.queryByText("Decision 101", { exact: false })).toBeNull();
    view.rerender(surface({ state: { ...initial, turns: [newer], decisions: 102 } }));
    fireEvent.click(view.getByRole("tab", { name: "Details" }));
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

  it("does not freeze an empty Details tab before the first answer arrives", async () => {
    const { surface, state } = await fixture();
    const view = render(
      surface({ state: { ...state, turns: [], last: null, lastModel: null, decisions: 0 } }),
    );
    fireEvent.click(view.getByRole("tab", { name: "Details" }));
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
    await waitFor(() => expect(view.getByRole("tab", { name: "Detalhes" })).toBeTruthy());
    expect(view.container.querySelector(".inspector-pre")?.textContent).toBe(input);
    expect(view.getByText("Leitura fixada")).toBeTruthy();
  });
});
