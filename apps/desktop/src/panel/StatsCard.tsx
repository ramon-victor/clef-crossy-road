import { useI18n } from "../i18n/provider.tsx";
import type { SessionState } from "../session.ts";

export function StatsCard({ state }: { state: SessionState }) {
  const { t, number, ms } = useI18n();
  const stats: readonly [label: string, value: string][] = [
    [t("stats.rows"), number(state.score)],
    [t("stats.decisions"), number(state.decisions)],
    [t("stats.latency"), ms(state.avgLatencyMs)],
    [t("stats.tokens"), state.avgTokens === null ? "–" : number(Math.round(state.avgTokens))],
    [t("stats.invalid"), number(state.invalidMoves)],
    [t("stats.cached"), number(state.cacheHits)],
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
