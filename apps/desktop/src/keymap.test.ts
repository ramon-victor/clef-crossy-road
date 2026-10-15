import { describe, expect, it } from "vitest";
import { commandForKey } from "./keymap.ts";

const press = (
  key: string,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {},
) => commandForKey({ key, ctrlKey: false, metaKey: false, altKey: false, ...modifiers });

describe("commandForKey", () => {
  it.each([
    ["ArrowUp", "hop_forward"],
    ["w", "hop_forward"],
    ["W", "hop_forward"],
    ["ArrowDown", "hop_back"],
    ["S", "hop_back"],
    ["ArrowLeft", "hop_left"],
    ["a", "hop_left"],
    ["ArrowRight", "hop_right"],
    ["D", "hop_right"],
  ])("%s moves the chicken %s", (key, action) => {
    expect(press(key)).toEqual({ type: "move", action });
  });

  it.each([
    [" ", "pause"],
    ["n", "step"],
    ["N", "step"],
    ["r", "retry"],
    ["m", "newMap"],
    ["i", "inspect"],
    ["I", "inspect"],
  ])("%j is the %s command", (key, type) => {
    expect(press(key)).toEqual({ type });
  });

  it("ignores the keys the game does not use", () => {
    for (const key of ["Enter", "Tab", "Escape", "x", "1"]) expect(press(key)).toBeUndefined();
  });

  it("leaves browser shortcuts alone: Ctrl+R must reload, not retry, and Ctrl+W must not move", () => {
    expect(press("r", { ctrlKey: true })).toBeUndefined();
    expect(press("w", { ctrlKey: true })).toBeUndefined();
    expect(press("ArrowLeft", { altKey: true })).toBeUndefined();
    expect(press("m", { metaKey: true })).toBeUndefined();
  });

  it("does not pause for a consumed key or move while text composition is in progress", () => {
    const modifiers = { ctrlKey: false, metaKey: false, altKey: false };
    expect(commandForKey({ ...modifiers, key: " ", defaultPrevented: true })).toBeUndefined();
    expect(commandForKey({ ...modifiers, key: "w", isComposing: true })).toBeUndefined();
  });
});
