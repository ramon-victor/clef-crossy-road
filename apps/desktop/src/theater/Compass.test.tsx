// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import { LanguageProvider } from "../i18n/provider.tsx";
import { Compass } from "./Compass.tsx";
import type { ExecutionView } from "./execution.ts";
import { answeredSession, routeAnswers, waitingState } from "./test-support.ts";

afterEach(async () => {
  cleanup();
  // Flush deferred provider effects before jsdom removes window at the end of the file.
  await act(async () => {});
});

describe("compass execution hierarchy", () => {
  it("lights only pause while Clef's forward choice keeps its share on a chip", async () => {
    const session = await answeredSession(routeAnswers("stand", "still", "wait_here", 0.9), 1);
    const execution: ExecutionView = { action: "stay", next: null, blocked: false, overlay: null };
    const screen = render(
      <LanguageProvider initial={{ preference: "en", detected: "en" }}>
        <Compass
          session={session}
          state={session.state()}
          execution={execution}
          anchorRef={{ current: null }}
        />
      </LanguageProvider>,
    );
    expect(screen.container.querySelectorAll(".cb.actual")).toHaveLength(1);
    expect(screen.container.querySelector(".cb.actual")?.getAttribute("data-move")).toBe("stay");
    const chips = [...screen.container.querySelectorAll(".cp")];
    expect(
      Object.fromEntries(chips.map((c) => [c.getAttribute("data-label"), c.textContent])),
    ).toEqual({ hop_forward: "95%", hop_left: "1%", hop_right: "3%", stay: "1%" });
    expect(
      chips.filter((c) => c.classList.contains("chosen")).map((c) => c.getAttribute("data-label")),
    ).toEqual(["hop_forward"]);
    expect(screen.container.querySelector(".cb .cp")).toBeNull();
    expect(screen.container.querySelector(".cb-badge")).toBeNull();

    screen.rerender(
      <LanguageProvider initial={{ preference: "en", detected: "en" }}>
        <Compass
          session={session}
          state={session.state()}
          execution={{ ...execution, action: "hop_forward" }}
          anchorRef={{ current: null }}
        />
      </LanguageProvider>,
    );
    expect(screen.container.querySelectorAll(".cb.actual")).toHaveLength(1);
    expect(screen.container.querySelector(".cb.actual")?.getAttribute("data-move")).toBe(
      "hop_forward",
    );
    expect(screen.container.querySelector('[data-move="stay"]')?.classList.contains("actual")).toBe(
      false,
    );
  });

  it("keeps the pick the pause waits for on its chip through the frames between two waits", async () => {
    const session = await answeredSession(routeAnswers("stand", "still", "wait_here", 0.9), 1);
    const state = waitingState(session.state());
    const compass = (execution: ExecutionView) => (
      <LanguageProvider initial={{ preference: "en", detected: "en" }}>
        <Compass
          session={session}
          state={state}
          execution={execution}
          anchorRef={{ current: null }}
        />
      </LanguageProvider>
    );
    const screen = render(compass({ action: "stay", next: null, blocked: false, overlay: null }));
    const pause = screen.container.querySelector('.cp[data-label="stay"]');
    expect(pause?.textContent).toBe("95%");
    expect(pause?.querySelector(".cp-arrow")).not.toBeNull();
    expect(pause?.classList.contains("chosen")).toBe(true);

    screen.rerender(compass({ action: null, next: null, blocked: false, overlay: null }));
    expect(screen.container.querySelector(".cb.actual")).toBeNull();
    expect(screen.container.querySelector('.cp[data-label="stay"]')).toBe(pause);
  });

  it("labels a held or queued answer as next and clears the display on error", async () => {
    const session = await answeredSession(routeAnswers("stand", "still", "wait_here", 0.9), 1);
    const execution: ExecutionView = {
      action: "hop_forward",
      next: "hop_right",
      blocked: false,
      overlay: null,
    };
    const screen = render(
      <LanguageProvider initial={{ preference: "en", detected: "en" }}>
        <Compass
          session={session}
          state={session.state()}
          execution={execution}
          anchorRef={{ current: null }}
        />
      </LanguageProvider>,
    );
    expect(screen.container.querySelectorAll(".cb.actual")).toHaveLength(1);
    expect(screen.container.querySelectorAll(".cb.next")).toHaveLength(1);
    expect(screen.container.querySelector(".cb.next")?.getAttribute("data-move")).toBe("hop_right");
    screen.rerender(
      <LanguageProvider initial={{ preference: "en", detected: "en" }}>
        <Compass
          session={session}
          state={{ ...session.state(), phase: "error" }}
          execution={execution}
          anchorRef={{ current: null }}
        />
      </LanguageProvider>,
    );
    expect(screen.container.querySelector(".compass")).toBeNull();
  });
});
