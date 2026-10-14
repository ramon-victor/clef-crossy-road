import { ms } from "../format.ts";
import type { SessionState } from "../session.ts";

export function StatsCard({ state }: { state: SessionState }) {
  const stats: readonly [label: string, value: string][] = [
    ["Rows", String(state.score)],
    ["Decisions", String(state.decisions)],
    ["Latency", ms(state.avgLatencyMs)],
    ["Tokens", state.avgTokens === null ? "–" : String(Math.round(state.avgTokens))],
    ["Invalid", String(state.invalidMoves)],
    ["Cached", String(state.cacheHits)],
  ];
  return (
    <section class="card stats">
      {stats.map(([label, value]) => (
        <div class="stat" key={label}>
          <div class="stat-value">{value}</div>
          <div class="stat-label">{label}</div>
        </div>
      ))}
    </section>
  );
}
