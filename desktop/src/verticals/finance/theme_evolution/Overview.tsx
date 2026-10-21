/** 全局题材时间线:近 7 个已生成日,缺日留空而不是画成 0。 */
import { GlassCard } from "@/components/ui/GlassCard";
import { cn } from "@/lib/utils";
import { shortDate, stageTone, type ThemeTimeline } from "@/lib/themeEvolution";

export function ThemeOverview({ timelines, dates, selectedId, onSelect }: {
  timelines: ThemeTimeline[]; dates: string[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const rows = [...timelines].sort((a, b) => {
    const la = a.timeline[a.timeline.length - 1]?.limit_up ?? -1;
    const lb = b.timeline[b.timeline.length - 1]?.limit_up ?? -1;
    return lb - la || a.name.localeCompare(b.name);
  });
  return (
    <GlassCard className="p-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-semibold">近 7 个已生成日</h3>
        <span className="text-[11px] text-muted-foreground">数字是当天该题材的涨停家数;「·」= 那天没生成快照或没这个题材,不是 0</span>
      </div>
      {!rows.length ? (
        <p className="py-4 text-center text-[12px] text-muted-foreground">还没有可画的时间线;先构建一天的快照。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-border/50 text-muted-foreground">
                <th className="px-2 py-1.5 text-left font-medium">题材</th>
                {dates.map((d) => <th key={d} className="px-2 py-1.5 text-center font-medium">{shortDate(d)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.theme_id} className="border-b border-border/25 last:border-0">
                  <td className="max-w-40 truncate px-2 py-1.5">
                    <button type="button" onClick={() => onSelect(t.theme_id)}
                      aria-current={selectedId === t.theme_id ? "true" : undefined}
                      className={cn("truncate text-left underline-offset-2 hover:underline", selectedId === t.theme_id ? "font-semibold text-primary" : "text-foreground")}>
                      {t.name}
                    </button>
                  </td>
                  {dates.map((d) => {
                    const p = t.timeline.find((x) => x.date === d);
                    if (!p || !p.stage) {
                      return <td key={d} className="px-2 py-1.5 text-center text-muted-foreground" title="这天没生成快照或没这个题材">·</td>;
                    }
                    return (
                      <td key={d} className="px-2 py-1.5 text-center tabular-nums">
                        <span className={cn("inline-flex min-w-9 items-center justify-center rounded border px-1 py-0.5", stageTone(p.stage))} title={`${p.stage} · 最高 ${p.highest ?? "—"} 板`}>
                          {p.limit_up ?? "—"}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </GlassCard>
  );
}
