import { type Action, type MoveOutcome, START_ROW } from "@ccr/core";

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
  /**
   * How many rows behind the furthest row reached the chicken stands now (0 when it is at the front).
   * A player sees it on screen: the counter says how far they got and the chicken is somewhere else.
   */
  readonly behindFrontier: number;
}

export const emptyMemory = (): Memory => ({
  recent: [],
  score: 0,
  sinceProgress: 0,
  behindFrontier: 0,
});

/**
 * The memory after `move`, once the score it led to is known. `heroRow` is the row the chicken stands on
 * afterwards (`Game.heroRow`); without it the chicken counts as being at the front.
 */
export function remember(
  memory: Memory,
  move: RememberedMove,
  score: number,
  heroRow?: number,
): Memory {
  const best = Math.max(memory.score, score);
  const here = heroRow === undefined ? best : Math.max(heroRow - START_ROW, 0);
  return {
    recent: [...memory.recent, move].slice(-MEMORY_MOVES),
    score: best,
    sinceProgress: score > memory.score ? 0 : memory.sinceProgress + 1,
    behindFrontier: Math.max(best - here, 0),
  };
}
