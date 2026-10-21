// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "../i18n/provider.tsx";
import { translator } from "../i18n/translate.ts";
import type { DecisionLog } from "../session.ts";
import { CompassCaption } from "./CompassCaption.tsx";
import { buildCaption } from "./caption.ts";
import type { ExecutionView } from "./execution.ts";
import { answeredSession, routeAnswers } from "./test-support.ts";

afterEach(async () => {
  await act(async () => cleanup());
});

it("keeps one readable status through 15 waits and history eviction, with Details usable throughout", async () => {
  const session = await answeredSession(routeAnswers("stand", "still", "wait_here"), 1);
  const state = session.state();
  const open = vi.fn();
  const logs: DecisionLog[] = [...state.history];
  const execution: ExecutionView = { action: "stay", next: null, blocked: false, overlay: null };
  const ui = (n: number, boundary = false) => {
    const last: DecisionLog = {
      index: n,
      tick: n * 12,
      row: 8,
      action: "stay",
      wallMs: 0,
      decision: {
        action: "stay",
        source: "executor",
        extra: { controller: { kind: "wait", n, of: 15, cell: "water" } },
      },
    };
    if (!boundary) logs.push(last);
    const view = buildCaption(
      {
        ...state,
        last,
        phase: boundary ? "idle" : "hopping",
        history: logs.slice(-14),
        playback: { index: n, outcome: "stay" },
        turns: state.lastModel ? [{ model: state.lastModel, steps: logs.slice(1) }] : [],
      },
      { ...execution, action: boundary ? null : "stay" },
      translator("pt-BR"),
    );
    if (!view) throw new Error("Missing wait caption");
    return (
      <LanguageProvider initial={{ preference: "pt-BR", detected: "pt-BR" }}>
        <CompassCaption view={view} conversationOpen={false} onConversation={open} />
      </LanguageProvider>
    );
  };
  const screen = render(ui(1));
  const status = screen.getByRole("status");
  const card = screen.container.querySelector(".compass-caption");
  const strip = screen.container.querySelector(".cap-strip");
  const details = screen.getByRole("button", { name: "Detalhes" });
  details.focus();
  for (let n = 1; n <= 15; n++) {
    if (n > 1) screen.rerender(ui(n));
    screen.rerender(ui(n, true));
    expect(screen.getByRole("status")).toBe(status);
    expect(status.textContent).toBe("Controlador Esperando um tronco");
    expect(screen.container.querySelector(".compass-caption")).toBe(card);
    expect(screen.container.querySelector(".cap-strip")).toBe(strip);
    expect(screen.container.querySelector(".cap-choice")?.textContent).toContain("Clef escolheu:");
    expect(screen.container.querySelectorAll(".hchip").length).toBeLessThanOrEqual(6);
    expect(card?.textContent).not.toMatch(/\d|×/u);
    expect(document.activeElement).toBe(details);
  }
  fireEvent.click(details);
  expect(open).toHaveBeenCalledOnce();
});

it("keeps queued movement secondary and omits the Details shortcut when the conversation is open", () => {
  const screen = render(
    <LanguageProvider initial={{ preference: "en", detected: "en" }}>
      <CompassCaption
        view={{
          text: "Now: forward",
          glyph: "↑",
          context: "next: right",
          strip: [],
          active: true,
          by: null,
          unaided: false,
        }}
        conversationOpen
        onConversation={() => {}}
      />
    </LanguageProvider>,
  );
  expect(screen.getByRole("status").textContent).toBe("Now: forward");
  expect(screen.container.querySelector(".cap-choice")?.textContent).toBe("next: right");
  expect(screen.queryByRole("button")).toBeNull();
});

it("tags the move with who made it, and marks a chicken nobody helped", () => {
  const view = {
    text: "Now: back",
    glyph: "↓",
    context: null,
    strip: [],
    active: true,
    by: { who: "controller" as const, label: "Controller" },
    unaided: false,
  };
  const screen = render(
    <LanguageProvider initial={{ preference: "en", detected: "en" }}>
      <CompassCaption view={view} conversationOpen onConversation={() => {}} />
    </LanguageProvider>,
  );
  expect(screen.getByRole("status").textContent).toBe("Controller Now: back");
  expect(screen.container.querySelector(".cap-by.controller")?.textContent).toBe("Controller");
  screen.rerender(
    <LanguageProvider initial={{ preference: "en", detected: "en" }}>
      <CompassCaption
        view={{ ...view, text: "Nothing stepped in", by: null, unaided: true }}
        conversationOpen
        onConversation={() => {}}
      />
    </LanguageProvider>,
  );
  expect(screen.container.querySelector(".cap-main.unaided")?.textContent).toBe(
    "Nothing stepped in",
  );
  expect(screen.container.querySelector(".cap-by")).toBeNull();
});
