/** 单个题材的时间线:每天的规则阶段与涨停家数;缺日留空。 */
import { cn } from "@/lib/utils";
import { shortDate, stageTone, type ThemeTimeline as TimelineData } from "@/lib/themeEvolution";

export function ThemeTimelineStrip({ timeline }: { timeline: TimelineData | null }) {
  if (!timeline) return <p className="text-[11px] text-muted-foreground">这个题材还没有历史快照。</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {timeline.timeline.map((p) => (
        <div key={p.date} className="min-w-16 rounded-lg border border-border/50 px-2 py-1.5 text-center">
          <div className="text-[10px] text-muted-foreground">{shortDate(p.date)}</div>
          {p.stage ? (
            <>
              <span className={cn("mt-0.5 inline-flex rounded border px-1 py-0.5 text-[10px]", stageTone(p.stage))}>{p.stage}</span>
              <div className="mt-0.5 font-mono text-[11px] tabular-nums">{p.limit_up ?? "—"} 只 · {p.highest ?? "—"} 板</div>
            </>
          ) : (
            <div className="mt-1 text-[11px] text-muted-foreground" title="这天没生成快照或没这个题材">缺</div>
          )}
        </div>
      ))}
    </div>
  );
}
