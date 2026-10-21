/** 左侧题材树:宏观方向 → 主线 → 分支;没有父节点的候选也按根节点列出来。 */
import { ChevronRight } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { cn } from "@/lib/utils";
import { stageTone, treeChildren, type ThemeNodeView } from "@/lib/themeEvolution";

function Level({ nodes, parent, depth, selectedId, onSelect, seen }: {
  nodes: Map<string | null, ThemeNodeView[]>; parent: string | null; depth: number;
  selectedId: string | null; onSelect: (id: string) => void; seen: Set<string>;
}) {
  const list = nodes.get(parent) ?? [];
  return (
    <ul className={cn(depth > 0 && "ml-3 border-l border-border/40 pl-2")}>
      {list.map((n) => {
        if (seen.has(n.id) || depth > 4) return null;
        seen.add(n.id);
        const kids = (nodes.get(n.id) ?? []).filter((k) => !seen.has(k.id));
        return (
          <li key={n.id}>
            <button type="button" onClick={() => onSelect(n.id)}
              aria-current={selectedId === n.id ? "true" : undefined}
              className={cn(
                "flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[12px] hover:bg-muted/40",
                selectedId === n.id ? "bg-primary/10 font-semibold text-primary" : "text-foreground",
              )}>
              <ChevronRight className={cn("h-3 w-3 shrink-0 text-muted-foreground", kids.length && "rotate-90")} />
              <span className="min-w-0 flex-1 truncate">{n.name}</span>
              {n.stage && (
                <span className={cn("shrink-0 rounded border px-1 text-[10px]", stageTone(n.stage))}>{n.stage}</span>
              )}
              <span className="w-6 shrink-0 text-right font-mono text-[10px] text-muted-foreground tabular-nums">
                {n.has_data ? (n.limit_up ?? "—") : "—"}
              </span>
              {!n.confirmed && <span className="shrink-0 text-[10px] text-warning">候选</span>}
            </button>
            {kids.length > 0 && <Level nodes={nodes} parent={n.id} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} seen={seen} />}
          </li>
        );
      })}
    </ul>
  );
}

export function ThemeTree({ nodes, selectedId, onSelect }: {
  nodes: ThemeNodeView[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const map = treeChildren(nodes);
  return (
    <GlassCard className="p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">题材树</h3>
        <span className="text-[10px] text-muted-foreground">{nodes.filter((n) => n.has_data).length} 个有数据</span>
      </div>
      {nodes.length ? (
        <div className="max-h-[520px] overflow-y-auto pr-1">
          <Level nodes={map} parent={null} depth={0} selectedId={selectedId} onSelect={onSelect} seen={new Set()} />
        </div>
      ) : (
        <p className="py-4 text-center text-[12px] text-muted-foreground">这一天还没有题材节点。</p>
      )}
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        层级来自注册表:人工确认过的节点不会被 AI 提案改动;未确认的标「候选」。
      </p>
    </GlassCard>
  );
}
