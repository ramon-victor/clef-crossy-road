// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider, useI18n } from "../i18n/provider.tsx";
import type { SessionState } from "../session.ts";
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
  };
  const surface = (next: Partial<TheaterProps> = {}) => (
    <LanguageProvider initial={{ preference: "en", detected: "en" }}>
      <Theater {...props} {...next} />
    </LanguageProvider>
  );
  return { props, session, state, surface };
}

describe("readable model conversation", () => {
  it("separates the model maneuver from controller steps and makes alternatives optional", async () => {
    const { surface, props, session } = await fixture();
    const before = session.state();
    const view = render(surface());
    expect(view.container.querySelector(".model-move")?.textContent).toContain(
      "Chosen maneuver: Detour right",
    );
    expect(view.container.querySelector(".bub.controller")?.textContent).toContain(
      "Action sent to the game",
    );
    expect(view.container.querySelectorAll(".controller-steps li").length).toBeGreaterThan(0);
    const alternatives = view.container.querySelectorAll<HTMLDetailsElement>(".answer-options");
    expect(alternatives).toHaveLength(3);
    expect([...alternatives].every((item) => !item.open)).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Pause", exact: true }));
    fireEvent.click(view.getByRole("button", { name: "Compass (C)" }));
    fireEvent.click(view.getByRole("button", { name: "Hide decisions (T)" }));
    expect(props.onPause).toHaveBeenCalledOnce();
    expect(props.onCompass).toHaveBeenCalledOnce();
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(session.state()).toEqual(before);
  });

  it("does not present a held answer as an action already sent to the game", async () => {
    const { surface, state } = await fixture();
    const turn = state.turns[0];
    if (!turn) throw new Error("Missing turn");
    const held: SessionState = {
      ...state,
      phase: "reading",
      last: turn.model,
      turns: [{ ...turn, steps: [] }],
    };
    const view = render(surface({ state: held }));
    expect(view.container.querySelector(".execution-status")?.textContent).toContain("Next action");
    view.rerender(surface({ state: { ...held, phase: "hopping" } }));
    expect(view.container.querySelector(".execution-status")?.textContent).toBe(
      "Action sent to the game",
    );
  });

  it("pins an older round, copies that request and keeps it when the live buffer moves on", async () => {
    const { surface, state } = await fixture();
    const original = state.turns[0];
    if (!original?.model.decision.sent) throw new Error("Missing input");
    const older = {
      ...original,
      model: {
        ...original.model,
        decision: {
          ...original.model.decision,
          sent: { ...original.model.decision.sent, state: { example: "older request" } },
        },
      },
    };
    const newer = {
      model: {
        ...original.model,
        index: 100,
        row: 99,
        decision: {
          ...original.model.decision,
          sent: { ...original.model.decision.sent, state: { example: "newer request" } },
        },
      },
      steps: [],
    };
    const initial = { ...state, decisions: 101, turns: [older, newer], last: newer.model };
    const copy = vi.fn(async (_text: string) => {});
    vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
    const view = render(surface({ state: initial }));
    const first = view.container.querySelector<HTMLButtonElement>(".turn-heading");
    expect(first?.getAttribute("aria-expanded")).toBe("false");
    if (!first) throw new Error("Missing heading");
    fireEvent.click(first);
    fireEvent.click(
      view.container.querySelector<HTMLButtonElement>(".turn-technical") as HTMLButtonElement,
    );
    await waitFor(() =>
      expect(view.container.querySelector(".inspector-pre")?.textContent).toContain(
        "older request",
      ),
    );
    expect(view.container.querySelector('[role="dialog"]')).toBeNull();
    expect(view.container.querySelector(".inspector-chips")?.textContent).toContain(
      "controller steps",
    );
    fireEvent.click(view.getByRole("button", { name: "Copy", exact: true }));
    await waitFor(() => expect(copy).toHaveBeenCalledOnce());
    expect(JSON.parse(copy.mock.calls[0]?.[0] ?? "{}").state.example).toBe("older request");
    view.rerender(
      surface({ state: { ...initial, decisions: 102, turns: [newer], history: [newer.model] } }),
    );
    expect(view.container.querySelector(".inspector-pre")?.textContent).toContain("older request");
    fireEvent.click(view.getByRole("button", { name: "Back to live" }));
    expect(view.container.querySelector(".inspector")).toBeNull();
    expect(view.container.querySelectorAll(".turn")).toHaveLength(1);
    expect(view.container.querySelector(".turn-heading")?.textContent).toContain("Decision 101");
  });

  it("opens the latest request on I even while reading an older snapshot", async () => {
    const { surface, state } = await fixture();
    const view = render(surface());
    fireEvent.click(view.getByRole("button", { name: "Full text (I)" }));
    const original = state.turns[0];
    if (!original?.model.decision.sent) throw new Error("Missing input");
    const newer = {
      model: {
        ...original.model,
        index: 100,
        decision: {
          ...original.model.decision,
          sent: { ...original.model.decision.sent, state: { marker: "latest" } },
        },
      },
      steps: [],
    };
    view.rerender(
      surface({ state: { ...state, turns: [newer], decisions: 101 }, inspectVersion: 1 }),
    );
    await waitFor(() =>
      expect(view.container.querySelector(".inspector-pre")?.textContent).toContain("latest"),
    );
  });

  it("retains an early I request until an answer arrives and clears reading state on same-seed retries", async () => {
    const { surface, state } = await fixture();
    const view = render(
      surface({ state: { ...state, turns: [], decisions: 0 }, inspectVersion: 1 }),
    );
    expect(view.container.querySelector(".inspector")).toBeNull();
    view.rerender(surface({ inspectVersion: 1 }));
    await waitFor(() => expect(view.container.querySelector(".inspector")).not.toBeNull());
    view.rerender(surface({ state: { ...state, episode: state.episode + 1 }, inspectVersion: 1 }));
    await waitFor(() => expect(view.container.querySelector(".inspector")).toBeNull());
    expect(view.queryByRole("button", { name: "Back to live" })).toBeNull();
  });

  it("does not carry an unanswered inspection request into a new game", async () => {
    const { surface, state } = await fixture();
    const view = render(
      surface({ state: { ...state, turns: [], decisions: 0 }, inspectVersion: 1 }),
    );
    const nextGame = { ...state, episode: state.episode + 1 };
    view.rerender(surface({ state: { ...nextGame, turns: [], decisions: 0 }, inspectVersion: 1 }));
    view.rerender(surface({ state: nextGame, inspectVersion: 1 }));
    await waitFor(() => expect(view.container.querySelector(".turn")).not.toBeNull());
    expect(view.container.querySelector(".inspector")).toBeNull();
    expect(view.queryByRole("button", { name: "Back to live" })).toBeNull();

    view.rerender(
      surface({ state: { ...nextGame, episode: nextGame.episode + 1 }, inspectVersion: 2 }),
    );
    await waitFor(() => expect(view.container.querySelector(".inspector")).not.toBeNull());
  });

  it("freezes scrolling away from live and clears the snapshot on a new game", async () => {
    const { surface, state } = await fixture();
    const view = render(surface());
    const feed = view.container.querySelector<HTMLDivElement>(".feed");
    if (!feed) throw new Error("Missing feed");
    Object.defineProperties(feed, { scrollHeight: { value: 1200 }, clientHeight: { value: 400 } });
    feed.scrollTop = 200;
    fireEvent.scroll(feed);
    expect(view.getByRole("button", { name: "Back to live" })).toBeTruthy();
    view.rerender(
      surface({ state: { ...state, seed: state.seed + 1, turns: [], decisions: 0, asking: null } }),
    );
    await waitFor(() => expect(view.queryByRole("button", { name: "Back to live" })).toBeNull());
    expect(view.getByText("Waiting for the first question…")).toBeTruthy();
  });

  it("retranslates a pinned conversation without changing its original input", async () => {
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
        <Theater {...props} />
      </LanguageProvider>,
    );
    fireEvent.click(view.getByRole("button", { name: "Full text (I)" }));
    const original = view.container.querySelector(".inspector-pre")?.textContent;
    fireEvent.click(view.getByRole("button", { name: "language" }));
    await waitFor(() => expect(view.getByRole("button", { name: "Voltar ao vivo" })).toBeTruthy());
    expect(view.container.querySelector(".inspector-pre")?.textContent).toBe(original);
    expect(view.container.querySelector(".model-move")?.textContent).toContain("Manobra escolhida");
  });

  it("shows non-model and error states without manufacturing a conversation", async () => {
    const { surface, state } = await fixture();
    const view = render(surface({ kind: "human", state: { ...state, human: true, paused: true } }));
    expect(view.getByText("You are at the keyboard.")).toBeTruthy();
    expect(view.container.querySelector(".bub.model")).toBeNull();
    view.rerender(surface({ kind: "reference", minimized: true }));
    expect(view.getByText("This player asks no model.")).toBeTruthy();
    expect(view.getByRole("button", { name: "Pause", exact: true }).hasAttribute("disabled")).toBe(
      true,
    );
    view.rerender(
      surface({
        state: {
          ...state,
          error: "Budget refused",
          errorInfo: { code: "unknown", detail: "Budget refused" },
        },
      }),
    );
    expect(view.container.querySelector(".theater-error")?.textContent).toContain("Budget refused");
  });
});
