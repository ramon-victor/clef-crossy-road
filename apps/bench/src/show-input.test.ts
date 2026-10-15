import { alwaysForward, clefPolicy, parseClefPolicyId } from "@ccr/agent";
import { ClefClient, type Transport } from "@ccr/clef";
import { describe, expect, it } from "vitest";
import { parseActions, renderShownInput, showInput } from "./show-input.ts";

/** A transport that fails the test if anything is ever sent. */
const neverSends: Transport = {
  post: async () => {
    throw new Error("show-input sent something");
  },
};
const clef = (id: string) =>
  clefPolicy(new ClefClient({ transport: neverSends }), parseClefPolicyId(id));

describe("parseActions", () => {
  it("reads a comma list and refuses unknown names", () => {
    expect(parseActions("hop_forward, hop_left")).toEqual(["hop_forward", "hop_left"]);
    expect(parseActions(undefined)).toEqual([]);
    expect(parseActions(" ")).toEqual([]);
    expect(() => parseActions("hop_up")).toThrow(/Unknown action "hop_up"/);
  });
});

describe("showInput", () => {
  it("prints the question, the options and the state for a state, and sends nothing", () => {
    const shown = showInput(clef("clef:clef-flash:json-fx:choice:full"), 4, ["hop_forward"]);
    const text = renderShownInput(shown);
    expect(text).toContain("sees:       forecast");
    expect(text).toContain("seed 4 after 1 move (hop_forward)");
    expect(text).toContain('== QUESTION "move" (choice) ==');
    expect(text).toContain("hop_forward: ");
    expect(text).toContain("== STATE ==");
    expect(text).toContain('"last_moves"');
  });

  it("shows the memory the player would have, so a stuck state shows the bumps", () => {
    const shown = showInput(clef("clef:clef-flash:json-fx:choice:full"), 1, [
      "hop_right",
      "hop_right",
    ]);
    expect(JSON.stringify(shown.input.state)).toContain("blocked by a tree");
  });

  it("refuses a policy that never asks a model, and a state in which the chicken is dead", () => {
    expect(() => showInput(alwaysForward, 1, [])).toThrow(/does not send anything/);
    const dies = Array(30).fill("hop_forward");
    expect(() => showInput(clef("clef:clef-flash:json:choice:full"), 4, dies)).toThrow(/dead/);
  });
});
