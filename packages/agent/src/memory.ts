import type { Action, MoveOutcome } from "@ccr/core";

/** How many past moves a player keeps in mind. */
export const MEMORY_MOVES = 6;

export interface RememberedMove {
  action: Action;
  outcome: MoveOutcome;
}

/**
 * What a person remembers when it is their turn again: the last few moves and what each one did, the
 * score counter on screen, and how many moves ago they last reached a new row. It holds only things the
 * player saw happen. The runner and the desktop session build it and hand it to the policy, which is
 * what lets a model notice "I keep bumping into the same tree".
 */
export interface Memory {
  readonly recent: readonly RememberedMove[];
  /** Furthest row reached so far, the number the game shows. */
  readonly score: number;
  /** Decisions since the score last went up. */
  readonly sinceProgress: number;
}

export const emptyMemory = (): Memory => ({ recent: [], score: 0, sinceProgress: 0 });

/** The memory after `move`, once the score it led to is known. */
export function remember(memory: Memory, move: RememberedMove, score: number): Memory {
  return {
    recent: [...memory.recent, move].slice(-MEMORY_MOVES),
    score: Math.max(memory.score, score),
    sinceProgress: score > memory.score ? 0 : memory.sinceProgress + 1,
  };
}
