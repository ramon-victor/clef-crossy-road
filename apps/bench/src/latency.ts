import type { LatencyModel, PolicyFactory } from "@ccr/agent";

const PIPELINED = ":pipelined";

/** `none`, `fixed:<ms>` or `recorded`, optionally followed by `:pipelined`. */
export function parseLatency(spec: string | undefined): LatencyModel | undefined {
  if (!spec || spec === "none") return undefined;
  const pipelined = spec.endsWith(PIPELINED);
  const base = pipelined ? spec.slice(0, -PIPELINED.length) : spec;
  const flag = pipelined ? { pipelined } : {};
  if (base === "recorded") return { kind: "recorded", ...flag };
  const fixed = /^fixed:(\d+)$/.exec(base);
  if (fixed) return { kind: "fixed", ms: Number(fixed[1]), ...flag };
  throw new Error(
    `Bad --latency "${spec}": use none, fixed:<ms>, recorded, optionally with ${PIPELINED}`,
  );
}

/** `@lat300`, `@latp300`, `@latrec` or `@latprec` (the `p` marks pipelined); empty without latency. */
export function latencySuffix(latency: LatencyModel | undefined): string {
  if (!latency || latency.kind === "none") return "";
  const pipelined = latency.pipelined ? "p" : "";
  return `@lat${pipelined}${latency.kind === "fixed" ? latency.ms : "rec"}`;
}

/** Keeps results with different latency settings apart when runs are compared. */
export function withLatencySuffix(
  factory: PolicyFactory,
  latency: LatencyModel | undefined,
): PolicyFactory {
  const suffix = latencySuffix(latency);
  return suffix
    ? { id: `${factory.id}${suffix}`, create: (seed) => factory.create(seed) }
    : factory;
}

/**
 * Stored episodes only carry the policy id, so this is how a replay learns that they were played
 * with the pipelined latency model. It is the inverse of `latencySuffix`.
 */
export const isPipelinedPolicyId = (policyId: string): boolean => /@latp(\d+|rec)$/.test(policyId);
