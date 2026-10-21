// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import { LanguageProvider } from "../i18n/provider.tsx";
import { Compass } from "./Compass.tsx";
import type { ExecutionView } from "./execution.ts";
import { answeredSession, routeAnswers } from "./test-support.ts";

afterEach(cleanup);

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
          conversationOpen={false}
          onConversation={() => {}}
        />
      </LanguageProvider>,
    );
    expect(screen.container.querySelectorAll(".cb.actual")).toHaveLength(1);
    expect(screen.container.querySelector(".cb.actual")?.getAttribute("data-move")).toBe("stay");
    expect(screen.container.querySelector(".cap-choice")?.textContent).toContain("Go straight");
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
          conversationOpen={false}
          onConversation={() => {}}
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
          conversationOpen={false}
          onConversation={() => {}}
        />
      </LanguageProvider>,
    );
    expect(screen.container.querySelectorAll(".cb.actual")).toHaveLength(1);
    expect(screen.container.querySelectorAll(".cb.next")).toHaveLength(1);
    expect(screen.container.textContent).toContain("next: right");
    screen.rerender(
      <LanguageProvider initial={{ preference: "en", detected: "en" }}>
        <Compass
          session={session}
          state={{ ...session.state(), phase: "error" }}
          execution={execution}
          anchorRef={{ current: null }}
          conversationOpen={false}
          onConversation={() => {}}
        />
      </LanguageProvider>,
    );
    expect(screen.container.querySelector(".compass")).toBeNull();
  });
});
