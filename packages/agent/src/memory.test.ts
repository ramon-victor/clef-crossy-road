import { describe, expect, it } from "vitest";
import { emptyMemory, MEMORY_MOVES, remember } from "./memory.ts";

const forward = { action: "hop_forward", outcome: "hop" } as const;
const bump = { action: "hop_forward", outcome: "blocked" } as const;

describe("remember", () => {
  it("starts empty", () => {
    expect(emptyMemory()).toEqual({ recent: [], score: 0, sinceProgress: 0 });
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

  it("keeps only the last moves, oldest first, and does not change the memory it was given", () => {
    const first = remember(emptyMemory(), forward, 1);
    let memory = first;
    for (let i = 0; i < MEMORY_MOVES + 3; i++) memory = remember(memory, bump, 1);
    expect(memory.recent).toHaveLength(MEMORY_MOVES);
    expect(memory.recent.every((m) => m.outcome === "blocked")).toBe(true);
    expect(first.recent).toEqual([forward]);
  });
});
