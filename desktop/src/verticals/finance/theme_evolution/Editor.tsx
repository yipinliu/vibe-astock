/** 层级编辑:人工改名称 / 层级 / 父节点 / 别名、确认候选、恢复自动,以及增删关系。 */
import { useState } from "react";
import { AlertTriangle, Loader2, Plus, RotateCcw, Save, ShieldCheck, Trash2, X } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { type ThemeRegistry, type ThemeRegistryNode } from "@/lib/themeEvolution";

export const RELATION_TYPES = ["上游", "下游", "共振"];

export interface RegistryPayload {
  op: string; theme_id?: string; name?: string; level?: 1 | 2 | 3; parent_id?: string | null;
  aliases?: string[]; from?: string; to?: string; type?: string;
}

function nodeOf(registry: ThemeRegistry, id: string | null): ThemeRegistryNode | null {
  return (id ? registry.themes.find((t) => t.id === id) : null) ?? registry.themes[0] ?? null;
}

const splitAliases = (v: string): string[] =>
  v.split(/[,，、;；\n]/).map((x) => x.trim()).filter(Boolean);

export function ThemeEditor({ registry, selectedId, relations, busy, error, onSave, onClose }: {
  registry: ThemeRegistry;
  selectedId: string | null;
  relations: { from: string; to: string; type: string; manual: boolean }[];
  busy: boolean;
  error: string;
  onSave: (payload: RegistryPayload) => void;
  onClose: () => void;
}) {
  const first = nodeOf(registry, selectedId);
  const [nodeId, setNodeId] = useState(first?.id ?? "");
  const [name, setName] = useState(first?.name ?? "");
  const [level, setLevel] = useState<1 | 2 | 3>(first?.level ?? 2);
  const [parent, setParent] = useState(first?.parent_id ?? "");
  const [aliases, setAliases] = useState((first?.aliases ?? []).join("、"));
  const [edgeFrom, setEdgeFrom] = useState(first?.id ?? "");
  const [edgeTo, setEdgeTo] = useState("");
  const [edgeType, setEdgeType] = useState("共振");

  const current = nodeOf(registry, nodeId);
  const pick = (id: string) => {
    const n = nodeOf(registry, id);
    setNodeId(id);
    setName(n?.name ?? "");
    setLevel(n?.level ?? 2);
    setParent(n?.parent_id ?? "");
    setAliases((n?.aliases ?? []).join("、"));
    setEdgeFrom(id);
  };
  const parents = registry.themes.filter((t) => t.active && t.level === level - 1);
  const nameOf = (id: string) => registry.themes.find((t) => t.id === id)?.name ?? id;

  return (
    <GlassCard className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold">编辑题材层级</h3>
        <span className="text-[10px] text-muted-foreground">人工改过的节点不再接受 AI 提案</span>
        <button type="button" onClick={onClose} className="ml-auto rounded p-1 text-muted-foreground hover:text-foreground" aria-label="关闭编辑">
          <X className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <div role="alert" className="mb-3 flex items-start gap-1.5 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[11px] text-danger">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <label className="block text-[11px] text-muted-foreground">
            节点
            <select value={nodeId} onChange={(e) => pick(e.target.value)} disabled={busy}
              className="mt-1 w-full rounded-lg border border-border/60 bg-card px-2 py-1.5 text-[12px] text-foreground">
              {registry.themes.map((t) => <option key={t.id} value={t.id}>{t.name}({t.level} 级)</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[11px] text-muted-foreground">
              名称
              <input value={name} onChange={(e) => setName(e.target.value)} disabled={busy}
                className="mt-1 w-full rounded-lg border border-border/60 bg-card px-2 py-1.5 text-[12px] text-foreground" />
            </label>
            <label className="block text-[11px] text-muted-foreground">
              层级
              <select value={level} onChange={(e) => { setLevel(Number(e.target.value) as 1 | 2 | 3); setParent(""); }} disabled={busy}
                className="mt-1 w-full rounded-lg border border-border/60 bg-card px-2 py-1.5 text-[12px] text-foreground">
                <option value={1}>1 级 · 宏观方向</option>
                <option value={2}>2 级 · 主线题材</option>
                <option value={3}>3 级 · 分支题材</option>
              </select>
            </label>
          </div>
          <label className="block text-[11px] text-muted-foreground">
            父节点
            <select value={parent} onChange={(e) => setParent(e.target.value)} disabled={busy || level === 1}
              className="mt-1 w-full rounded-lg border border-border/60 bg-card px-2 py-1.5 text-[12px] text-foreground disabled:opacity-50">
              <option value="">不归并(先当候选)</option>
              {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="block text-[11px] text-muted-foreground">
            别名(用顿号 / 逗号分隔)
            <input value={aliases} onChange={(e) => setAliases(e.target.value)} disabled={busy}
              className="mt-1 w-full rounded-lg border border-border/60 bg-card px-2 py-1.5 text-[12px] text-foreground" />
          </label>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <button type="button" disabled={busy || !current}
              onClick={() => onSave({ op: "update_node", theme_id: nodeId, name, level, parent_id: parent || null, aliases: splitAliases(aliases) })}
              className="inline-flex items-center gap-1 rounded-lg border border-primary/50 bg-primary/10 px-2.5 py-1 text-[11px] text-primary hover:bg-primary/20 disabled:opacity-50">
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} 保存层级
            </button>
            <button type="button" disabled={busy || !current}
              onClick={() => onSave({ op: "confirm_theme", theme_id: nodeId })}
              className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50">
              <ShieldCheck className="h-3 w-3" /> 确认题材
            </button>
            <button type="button" disabled={busy || !current}
              onClick={() => onSave({ op: "reset_node", theme_id: nodeId })}
              className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50">
              <RotateCcw className="h-3 w-3" /> 恢复自动
            </button>
          </div>
          {current && (
            <p className="text-[10px] text-muted-foreground">
              来源:自动 {current.auto ? "是" : "否"} · 人工 {current.manual ? "是" : "否"} · 已确认 {current.confirmed ? "是" : "否"}
              {current.last_seen ? ` · 最近出现 ${current.last_seen}` : ""}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-[11px] text-muted-foreground">题材关系(上游 / 下游 / 共振)</div>
          <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
            <select value={edgeFrom} onChange={(e) => setEdgeFrom(e.target.value)} disabled={busy} aria-label="关系起点"
              className="rounded-lg border border-border/60 bg-card px-1.5 py-1 text-[11px] text-foreground">
              {registry.themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={edgeTo} onChange={(e) => setEdgeTo(e.target.value)} disabled={busy} aria-label="关系终点"
              className="rounded-lg border border-border/60 bg-card px-1.5 py-1 text-[11px] text-foreground">
              <option value="">选终点</option>
              {registry.themes.filter((t) => t.id !== edgeFrom).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={edgeType} onChange={(e) => setEdgeType(e.target.value)} disabled={busy} aria-label="关系类型"
              className="rounded-lg border border-border/60 bg-card px-1.5 py-1 text-[11px] text-foreground">
              {RELATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <button type="button" disabled={busy || !edgeTo}
            onClick={() => onSave({ op: "add_edge", from: edgeFrom, to: edgeTo, type: edgeType })}
            className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50">
            <Plus className="h-3 w-3" /> 添加关系
          </button>
          <ul className="space-y-1 text-[11px]">
            {relations.length === 0 && <li className="text-muted-foreground">还没有关系。</li>}
            {relations.map((r) => (
              <li key={`${r.from}-${r.to}`} className="flex items-center gap-1.5 rounded-lg border border-border/50 px-2 py-1">
                <span className="min-w-0 flex-1 truncate">{nameOf(r.from)} → {nameOf(r.to)}</span>
                <span className="text-[10px] text-muted-foreground">{r.type}{r.manual ? " · 人工" : ""}</span>
                <button type="button" disabled={busy} onClick={() => onSave({ op: "remove_edge", from: r.from, to: r.to })}
                  className="rounded p-0.5 text-muted-foreground hover:text-danger disabled:opacity-50" aria-label="删除关系">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            后端会校验层级、父节点和环;不合法会原样报错,不会硬写。人工节点不再被 AI 层级提案覆盖。
          </p>
        </div>
      </div>
    </GlassCard>
  );
}
