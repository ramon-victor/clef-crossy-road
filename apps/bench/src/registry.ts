import {
  alwaysForward,
  clefPolicy,
  DEFAULT_CLEF_ID,
  execCross,
  execRoute,
  execRouteLive,
  execRules,
  lookaheadPolicy,
  type PolicyFactory,
  parseClefPolicyId,
  randomPolicy,
  ruleLanes,
  ruleMoves,
  ruleView,
  ruleViewFx,
} from "@ccr/agent";
import type { ClefClient } from "@ccr/clef";

export const isClefPolicy = (id: string): boolean =>
  id === DEFAULT_CLEF_ID || id.startsWith("clef:");

/**
 * Policy ids accepted on the command line:
 *   always-forward | random | rule-view | rule-view-fx | rule-lanes | rule-moves | exec-cross | exec-rules | exec-route | exec-route-live | lookahead | lookahead-<depth> | lookahead-comp:<ms>
 *   clef | clef:<model>:<encoder>:<strategy>[:<manual>]   e.g. clef:clef-flash:json:choice:full
 */
export function parsePolicy(id: string, getClient: () => ClefClient): PolicyFactory {
  if (id === "always-forward") return alwaysForward;
  if (id === "random") return randomPolicy;
  if (id === ruleView.id) return ruleView;
  if (id === ruleViewFx.id) return ruleViewFx;
  if (id === ruleLanes.id) return ruleLanes;
  if (id === ruleMoves.id) return ruleMoves;
  if (id === execCross.id) return execCross;
  if (id === execRules.id) return execRules;
  if (id === execRoute.id) return execRoute;
  if (id === execRouteLive.id) return execRouteLive;
  if (id === "lookahead") return lookaheadPolicy();
  const depth = /^lookahead-(\d+)$/.exec(id);
  if (depth) return lookaheadPolicy(Number(depth[1]));
  const compensated = /^lookahead-comp:(\d+)$/.exec(id);
  if (compensated) return lookaheadPolicy(4, undefined, Number(compensated[1]));
  if (isClefPolicy(id)) return clefPolicy(getClient(), parseClefPolicyId(id));
  throw new Error(
    `Unknown policy "${id}". Try always-forward, random, lookahead, clef, or clef:<model>:<encoder>:<strategy>[:<manual>].`,
  );
}

/** "1..100", "5", "1,2,9" or a mix such as "1..10,50". */
export function parseSeeds(spec: string): number[] {
  const seeds: number[] = [];
  for (const part of spec.split(",").map((p) => p.trim())) {
    const range = /^(\d+)\.\.(\d+)$/.exec(part);
    if (range) {
      const [from, to] = [Number(range[1]), Number(range[2])];
      if (to < from) throw new Error(`Bad seed range "${part}"`);
      for (let s = from; s <= to; s++) seeds.push(s);
    } else if (/^\d+$/.test(part)) {
      seeds.push(Number(part));
    } else {
      throw new Error(`Bad seed spec "${part}"`);
    }
  }
  return seeds;
}
