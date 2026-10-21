/** 简报正文:左侧按时间列 topics,右侧读原文。图片只给链接,不自动加载远程图片。 */
import { FileText, Image as ImageIcon, Paperclip } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { cn } from "@/lib/utils";
import { fmtBriefingTime, type BriefingTopic } from "@/lib/briefing";

const titleOf = (t: BriefingTopic): string => t.title || (t.text.split("\n")[0] || "无标题").slice(0, 60);

export function FeedPanel({ topics, selectedId, onSelect }: {
  topics: BriefingTopic[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  if (!topics.length) {
    return (
      <GlassCard className="p-8 text-center">
        <FileText className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">还没有归档的简报。先在设置页填好访问令牌和订阅组 ID,再点右上角「同步」。</p>
      </GlassCard>
    );
  }
  const selected = topics.find((t) => t.topic_id === selectedId) ?? topics[0]!;
  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <GlassCard className="p-2">
        <div className="max-h-[70vh] space-y-1 overflow-y-auto">
          {topics.map((t) => (
            <button
              key={t.topic_id}
              type="button"
              onClick={() => onSelect(t.topic_id)}
              className={cn(
                "w-full rounded-lg border px-2.5 py-2 text-left transition-colors",
                t.topic_id === selected.topic_id
                  ? "border-primary/40 bg-primary/10"
                  : "border-transparent hover:bg-muted/20",
              )}
            >
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="font-mono">{fmtBriefingTime(t.create_time)}</span>
                {t.institution && <span className="rounded bg-primary/10 px-1 py-px font-medium text-primary">{t.institution}</span>}
                {t.digests && <span className="rounded bg-warning/10 px-1 py-px text-warning">精华</span>}
              </div>
              <div className="mt-0.5 line-clamp-2 text-[12px] font-medium leading-snug">{titleOf(t)}</div>
            </button>
          ))}
        </div>
      </GlassCard>

      <GlassCard className="p-4">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-mono">{fmtBriefingTime(selected.create_time)}</span>
          {selected.institution && <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">{selected.institution}</span>}
          {selected.author && <span>作者:{selected.author}</span>}
          <span className="ml-auto font-mono text-[10px] opacity-50">#{selected.topic_id}</span>
        </div>
        <h3 className="mb-2 text-base font-semibold leading-snug">{selected.title || "无标题"}</h3>
        <div className="max-h-[62vh] overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground/90">
          {selected.text || "（正文为空）"}
        </div>
        {(selected.images.length > 0 || selected.files.length > 0) && (
          <div className="mt-3 space-y-1.5 border-t border-border/40 pt-2 text-[11px]">
            {selected.images.map((url, i) => (
              <a key={`${url}-${i}`} href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary/80 hover:underline">
                <ImageIcon className="h-3 w-3" />图片 {i + 1}
              </a>
            ))}
            {selected.files.map((f, i) => (
              <a key={`${f.url}-${i}`} href={f.url || undefined} target="_blank" rel="noreferrer" className={cn("flex items-center gap-1", f.url ? "text-primary/80 hover:underline" : "text-muted-foreground")}>
                <Paperclip className="h-3 w-3" />{f.name || "附件"}
              </a>
            ))}
          </div>
        )}
        <p className="mt-3 text-[10px] text-muted-foreground">来自你个人订阅的简报,只保存在本机;页面不会自动加载远程图片。</p>
      </GlassCard>
    </div>
  );
}
