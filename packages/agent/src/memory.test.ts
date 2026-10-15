import { describe, expect, it } from "vitest";
import { emptyMemory, MEMORY_MOVES, remember } from "./memory.ts";

const forward = { action: "hop_forward", outcome: "hop" } as const;
const bump = { action: "hop_forward", outcome: "blocked" } as const;

describe("remember", () => {
  it("starts empty", () => {
    expect(emptyMemory()).toEqual({ recent: [], score: 0, sinceProgress: 0, behindFrontier: 0 });
  });

  it("resets the progress counter when a new row is reached and counts up otherwise", () => {
    let memory = remember(emptyMemory(), forward, 1);
    expect(memory).toMatchObject({ score: 1, sinceProgress: 0 });
    memory = remember(memory, bump, 1);
    memory = remember(memory, bump, 1);
    expect(memory).toMatchObject({ score: 1, sinceProgress: 2 });
    memory = remember(memory, forward, 2);
    expect(memory).toMatchObject({ score: 2, sinceProgress: 0 });
  });

  it("never forgets the furthest row, even if the score read is lower", () => {
    const memory = remember(remember(emptyMemory(), forward, 3), forward, 2);
    expect(memory.score).toBe(3);
  });

  it("knows how many rows behind its furthest row the chicken stands, from the row it is on", () => {
    // Rows are counted from START_ROW (8): standing on row 12 after reaching 12 is at the front.
    let memory = remember(emptyMemory(), forward, 4, 12);
    expect(memory.behindFrontier).toBe(0);
    memory = remember(memory, { action: "hop_back", outcome: "hop" }, 4, 11);
    expect(memory.behindFrontier).toBe(1);
    memory = remember(memory, { action: "hop_back", outcome: "hop" }, 4, 10);
    expect(memory.behindFrontier).toBe(2);
    memory = remember(memory, forward, 4, 12);
    expect(memory.behindFrontier).toBe(0);
    // Without the row it is taken to be at the front, which is what older callers meant.
    expect(remember(memory, bump, 4).behindFrontier).toBe(0);
  });

  it("keeps only the last moves, oldest first, and does not change the memory it was given", () => {
    const first = remember(emptyMemory(), forward, 1);
    let memory = first;
    for (let i = 0; i < MEMORY_MOVES + 3; i++) memory = remember(memory, bump, 1);
    expect(memory.recent).toHaveLength(MEMORY_MOVES);
    expect(memory.recent.every((m) => m.outcome === "blocked")).toBe(true);
    expect(first.recent).toEqual([forward]);
  });
});
