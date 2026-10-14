import {
  alwaysForward,
  type ClefPolicyConfig,
  clefPolicy,
  lookaheadPolicy,
  type PolicyFactory,
  randomPolicy,
} from "@ccr/agent";
import { CLEF_MODELS, type ClefClient, type ClefModel } from "@ccr/clef";

/**
 * Policy ids accepted on the command line:
 *   always-forward | random | lookahead | lookahead-<depth>
 *   clef:<model>:<encoder>:<strategy>[:<manual>]   e.g. clef:clef-flash:json:choice:full
 */
export function parsePolicy(id: string, getClient: () => ClefClient): PolicyFactory {
  if (id === "always-forward") return alwaysForward;
  if (id === "random") return randomPolicy;
  if (id === "lookahead") return lookaheadPolicy();
  const depth = /^lookahead-(\d+)$/.exec(id);
  if (depth) return lookaheadPolicy(Number(depth[1]));
  const comp = /^lookahead-comp:(\d+)$/.exec(id);
  if (comp) return lookaheadPolicy(4, undefined, Number(comp[1]));

  if (id.startsWith("clef:")) {
    const [, model, encoder, strategy, manual = "full"] = id.split(":");
    if (!CLEF_MODELS.includes(model as ClefModel)) throw new Error(`Unknown model in "${id}"`);
    if (encoder !== "json" && encoder !== "grid" && encoder !== "image")
      throw new Error(`Unknown encoder in "${id}"`);
    if (strategy !== "choice" && strategy !== "critic" && strategy !== "critic-go")
      throw new Error(`Unknown strategy in "${id}"`);
    if (manual !== "full" && manual !== "minimal") throw new Error(`Unknown manual in "${id}"`);
    const config: ClefPolicyConfig = { model: model as ClefModel, encoder, strategy, manual };
    return clefPolicy(getClient(), config);
  }
  throw new Error(
    `Unknown policy "${id}". Try always-forward, random, lookahead, or clef:<model>:<encoder>:<strategy>[:<manual>].`,
  );
}

export const isClefPolicy = (id: string): boolean => id.startsWith("clef:");

/** "1..100", "5", "1,2,9" or a mix such as "1..10,50". */
export function parseSeeds(spec: string): number[] {
  const seeds: number[] = [];
  for (const part of spec.split(",")) {
    const range = /^(\d+)\.\.(\d+)$/.exec(part.trim());
    if (range) {
      const [from, to] = [Number(range[1]), Number(range[2])];
      if (to < from) throw new Error(`Bad seed range "${part}"`);
      for (let s = from; s <= to; s++) seeds.push(s);
    } else if (/^\d+$/.test(part.trim())) {
      seeds.push(Number(part.trim()));
    } else {
      throw new Error(`Bad seed spec "${part}"`);
    }
  }
  return seeds;
}
