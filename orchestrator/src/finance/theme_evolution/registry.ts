/**
 * 题材层级注册表:持久化 DAG(宏观方向 → 主线题材 → 分支题材)+ 匹配 + 人工修正。
 *
 * 存储 `<dataRoot>/shortline/themes/registry.json`。纯逻辑,无网络、无 LLM;
 * manual 的节点字段不接受 AI 提案覆盖。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { readJsonIfExists, writeJson } from "../../fsutil.ts";
import { ServiceError } from "../../service.ts";

export const REGISTRY_SCHEMA = 1;
export const RELATION_TYPES = ["上游", "下游", "共振"] as const;
export type RelationType = (typeof RELATION_TYPES)[number];
const PRUNE_DAYS = 45;

export interface ThemeNode {
  id: string; name: string; level: 1 | 2 | 3; parent_id: string | null;
  aliases: string[]; auto: boolean; manual: boolean; active: boolean; confirmed: boolean;
  first_seen: string; last_seen: string; evidence: Record<string, number>;
}
export interface ThemeRelation { from: string; to: string; type: RelationType; manual: boolean }
export interface ThemeRegistry {
  schema: 1; updated_at: string; themes: ThemeNode[]; relations: ThemeRelation[];
}

export const registryFile = (dataRoot: string) => path.join(dataRoot, "shortline", "themes", "registry.json");
export const daysDir = (dataRoot: string) => path.join(dataRoot, "shortline", "themes", "days");

export function emptyRegistry(): ThemeRegistry {
  return { schema: REGISTRY_SCHEMA, updated_at: "", themes: [], relations: [] };
}

const nameKey = (s: string) => s.trim().toLowerCase();
const newId = () => `t_${crypto.randomBytes(4).toString("hex")}`;

export function loadRegistry(dataRoot: string): ThemeRegistry {
  const file = registryFile(dataRoot);
  const got = readJsonIfExists<ThemeRegistry>(file);
  if (!got) {
    if (fs.existsSync(file)) throw new ServiceError("theme_registry_corrupt", "题材注册表读不了(JSON 坏了或结构不对)");
    return emptyRegistry();
  }
  validateRegistry(got);
  return got;
}

/** 串行写:同一进程里两次人工编辑不会互相覆盖。 */
let writeChain: Promise<void> = Promise.resolve();
export function saveRegistry(dataRoot: string, reg: ThemeRegistry): Promise<void> {
  validateRegistry(reg);
  const snapshot = structuredClone(reg);
  snapshot.updated_at = new Date().toISOString();
  const p = writeChain.then(() => { writeJson(registryFile(dataRoot), snapshot); });
  writeChain = p.catch(() => undefined);
  return p;
}

function fail(msg: string): never {
  throw new ServiceError("theme_registry_invalid", msg);
}

export function validateRegistry(reg: ThemeRegistry): void {
  if (!reg || reg.schema !== REGISTRY_SCHEMA || !Array.isArray(reg.themes) || !Array.isArray(reg.relations)) {
    fail("题材注册表结构不对");
  }
  const byId = new Map<string, ThemeNode>();
  const names = new Map<string, string>();
  for (const t of reg.themes) {
    if (!/^t_[a-z0-9]{6,16}$/.test(String(t.id ?? ""))) fail(`题材 id 不合法:${t.id}`);
    if (byId.has(t.id)) fail(`题材 id 重复:${t.id}`);
    const name = String(t.name ?? "").trim();
    if (!name || name.length > 30) fail(`题材名不合法:${name || "(空)"}`);
    if (![1, 2, 3].includes(t.level)) fail(`题材「${name}」的 level 只能是 1–3`);
    if (!Array.isArray(t.aliases) || t.aliases.some((a) => typeof a !== "string" || !a.trim() || a.length > 30)) fail(`题材「${name}」的别名不合法`);
    if (t.parent_id !== null && typeof t.parent_id !== "string") fail(`题材「${name}」的 parent_id 不合法`);
    if (t.parent_id === t.id) fail(`题材「${name}」不能以自己为父节点`);
    for (const key of [name, ...t.aliases]) {
      const k = nameKey(key);
      const prev = names.get(k);
      if (prev && prev !== t.id) fail(`名称 / 别名「${key}」同时属于两个题材`);
      names.set(k, t.id);
    }
    byId.set(t.id, t);
  }
  for (const t of reg.themes) {
    if (t.level === 1 && t.parent_id !== null) fail(`一级题材「${t.name}」不能有父节点`);
    // 二级 / 三级可以先没有父节点(等人工或 AI 归并),有父节点就必须正好高一级
    if (t.level > 1 && t.parent_id) {
      const p = byId.get(t.parent_id);
      if (!p) fail(`「${t.name}」的父节点不存在`);
      if (p.level !== t.level - 1) fail(`「${t.name}」的父节点必须正好高一级`);
    }
    // 环
    const seen = new Set<string>([t.id]);
    let cur: ThemeNode | undefined = t;
    while (cur?.parent_id) {
      if (seen.has(cur.parent_id)) fail(`题材层级出现环:${t.name}`);
      seen.add(cur.parent_id);
      cur = byId.get(cur.parent_id);
    }
  }
  const edges = new Set<string>();
  for (const r of reg.relations) {
    if (!byId.has(r.from) || !byId.has(r.to)) fail("题材关系指向了不存在的节点");
    if (r.from === r.to) fail("题材关系不能指向自己");
    if (!RELATION_TYPES.includes(r.type)) fail(`题材关系类型不合法:${r.type}`);
    const key = `${r.from}\u0000${r.to}`;
    if (edges.has(key)) fail("题材关系重复");
    edges.add(key);
  }
}

/** 精确 name / alias → 双向包含(≥2 字,取最长)。 */
export function matchTheme(reg: ThemeRegistry, name: string): ThemeNode | null {
  const n = nameKey(name);
  if (!n || n.length < 2) return null;
  for (const t of reg.themes) {
    if (!t.active) continue;
    if (nameKey(t.name) === n || t.aliases.some((a) => nameKey(a) === n)) return t;
  }
  let best: { score: number; node: ThemeNode } | null = null;
  for (const t of reg.themes) {
    if (!t.active) continue;
    for (const key of [t.name, ...t.aliases]) {
      const k = nameKey(key);
      if (k.length < 2) continue;
      if (n.includes(k) || k.includes(n)) {
        if (!best || k.length > best.score) best = { score: k.length, node: t };
      }
    }
  }
  return best?.node ?? null;
}

export function bumpSeen(reg: ThemeRegistry, id: string, source: string, date: string): void {
  const t = reg.themes.find((x) => x.id === id);
  if (!t) return;
  if (!t.first_seen || date < t.first_seen) t.first_seen = date;
  if (!t.last_seen || date > t.last_seen) t.last_seen = date;
  t.evidence[source] = (t.evidence[source] ?? 0) + 1;
}

/** 来源名称 → 注册表节点;没有就新建 candidate(confirmed=false)。 */
export function ensureTheme(reg: ThemeRegistry, name: string, date: string, source: string): { node: ThemeNode; created: boolean } {
  const clean = String(name ?? "").trim().slice(0, 30);
  if (!clean) throw new ServiceError("bad_theme", "题材名是空的");
  const hit = matchTheme(reg, clean);
  if (hit) {
    bumpSeen(reg, hit.id, source, date);
    const taken = reg.themes.some((t) => [t.name, ...t.aliases].some((n) => nameKey(n) === nameKey(clean)));
    if (!hit.manual && !taken) hit.aliases.push(clean);
    return { node: hit, created: false };
  }
  const node: ThemeNode = {
    id: newId(), name: clean, level: 2, parent_id: null, aliases: [], auto: true, manual: false,
    active: true, confirmed: false, first_seen: date, last_seen: date, evidence: { [source]: 1 },
  };
  reg.themes.push(node);
  return { node, created: true };
}

export interface ManualPayload {
  theme_id?: unknown; parent_id?: unknown; level?: unknown; aliases?: unknown; name?: unknown;
  from?: unknown; to?: unknown; type?: unknown;
}
export function applyManual(reg: ThemeRegistry, action: string, p: ManualPayload): ThemeRegistry {
  const next = structuredClone(reg);
  const t = next.themes.find((x) => x.id === p.theme_id);
  if (action === "update_node") {
    if (!t) fail("题材不存在");
    if (typeof p.name === "string" && p.name.trim()) t.name = p.name.trim().slice(0, 30);
    if (typeof p.level === "number" && Number.isInteger(p.level) && [1, 2, 3].includes(p.level)) t.level = p.level as 1 | 2 | 3;
    if (p.parent_id === null || typeof p.parent_id === "string") t.parent_id = (p.parent_id as string) || null;
    if (Array.isArray(p.aliases)) t.aliases = [...new Set(p.aliases.filter((a): a is string => typeof a === "string").map((a) => a.trim()).filter(Boolean))].slice(0, 20);
    t.manual = true;
    validateRegistry(next);
    return next;
  }
  if (action === "add_edge") {
    const from = typeof p.from === "string" ? p.from : "";
    const to = typeof p.to === "string" ? p.to : "";
    if (p.type !== undefined && !RELATION_TYPES.includes(p.type as RelationType)) fail("关系类型只能是 上游 / 下游 / 共振");
    const type = (p.type as RelationType | undefined) ?? "共振";
    if (!next.themes.some((x) => x.id === from) || !next.themes.some((x) => x.id === to)) fail("关系指向了不存在的题材");
    if (from === to) fail("关系不能指向自己");
    if (next.relations.some((r) => r.from === from && r.to === to)) fail("这条关系已经有了");
    next.relations.push({ from, to, type, manual: true });
    validateRegistry(next);
    return next;
  }
  if (action === "remove_edge") {
    const from = typeof p.from === "string" ? p.from : "";
    const to = typeof p.to === "string" ? p.to : "";
    next.relations = next.relations.filter((r) => !(r.from === from && r.to === to));
    validateRegistry(next);
    return next;
  }
  if (action === "reset_node") {
    if (!t) fail("题材不存在");
    t.manual = false;
    validateRegistry(next);
    return next;
  }
  if (action === "confirm_theme") {
    if (!t) fail("题材不存在");
    t.confirmed = true;
    t.manual = true;
    validateRegistry(next);
    return next;
  }
  throw new ServiceError("bad_request", "只支持 update_node / add_edge / remove_edge / reset_node / confirm_theme");
}

export interface Proposal {
  macro_directions: { name: string; rationale?: string; members: string[] }[];
  relations: { from_name: string; to_name: string; relation_type: string }[];
  aliases: Record<string, string[]>;
}
export interface MergeResult { registry: ThemeRegistry; applied: string[]; skipped: string[] }

/** AI 层级提案合并:manual 节点不动;未知名称跳过;新节点 auto。 */
export function mergeProposal(reg: ThemeRegistry, raw: unknown): MergeResult {
  const next = structuredClone(reg);
  const applied: string[] = [];
  const skipped: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { registry: next, applied, skipped: ["提案不是对象"] };
  const p = raw as Record<string, unknown>;
  const allowed = new Set<string>();
  for (const t of next.themes) for (const n of [t.name, ...t.aliases]) allowed.add(nameKey(n));
  const macro = Array.isArray(p.macro_directions) ? p.macro_directions : [];
  for (const item of macro) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const x = item as Record<string, unknown>;
    const name = String(x.name ?? "").trim().slice(0, 30);
    if (!name || !allowed.has(nameKey(name))) { skipped.push(`宏观方向「${name || "(空)"}」不在输入名单里`); continue; }
    const parent = matchTheme(next, name);
    if (!parent) { skipped.push(`宏观方向「${name}」没匹配到题材`); continue; }
    if (parent.level >= 3) { skipped.push(`「${parent.name}」已经是三级题材,不能再挂子节点`); continue; }
    for (const member of Array.isArray(x.members) ? x.members : []) {
      const memberName = String(member ?? "").trim();
      const node = matchTheme(next, memberName);
      if (!node) { skipped.push(`成员「${memberName}」没匹配到题材`); continue; }
      if (node.id === parent.id) { skipped.push(`「${parent.name}」是宏观方向本身,不用挂到自己下面`); continue; }
      if (node.manual) { skipped.push(`「${node.name}」有人工层级,未改`); continue; }
      node.parent_id = parent.id;
      node.level = (Math.min(3, Math.max(2, parent.level + 1))) as 1 | 2 | 3;
      applied.push(`「${node.name}」挂到「${parent.name}」`);
    }
  }
  for (const item of Array.isArray(p.relations) ? p.relations : []) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const x = item as Record<string, unknown>;
    const a = matchTheme(next, String(x.from_name ?? ""));
    const b = matchTheme(next, String(x.to_name ?? ""));
    const type = String(x.relation_type ?? "");
    if (!a || !b || !RELATION_TYPES.includes(type as RelationType) || a.id === b.id) { skipped.push("有一条关系没匹配到题材或类型不合法"); continue; }
    if (next.relations.some((r) => r.from === a.id && r.to === b.id)) { skipped.push(`关系「${a.name}→${b.name}」已存在`); continue; }
    next.relations.push({ from: a.id, to: b.id, type: type as RelationType, manual: false });
    applied.push(`关系「${a.name}→${b.name}」`);
  }
  if (p.aliases && typeof p.aliases === "object" && !Array.isArray(p.aliases)) {
    for (const [name, aliases] of Object.entries(p.aliases as Record<string, unknown>)) {
      const node = matchTheme(next, name);
      if (!node || node.manual || !Array.isArray(aliases)) continue;
      for (const a of aliases) {
        const alias = String(a ?? "").trim().slice(0, 30);
        if (!alias || next.themes.some((t) => [t.name, ...t.aliases].some((n) => nameKey(n) === nameKey(alias)))) continue;
        node.aliases.push(alias);
        applied.push(`「${node.name}」加别名「${alias}」`);
      }
    }
  }
  try { validateRegistry(next); } catch (e) {
    return { registry: structuredClone(reg), applied: [], skipped: [e instanceof Error ? e.message : "提案合并后注册表不合法"] };
  }
  return { registry: next, applied, skipped };
}

export function pruneStale(reg: ThemeRegistry, today: string): ThemeRegistry {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - PRUNE_DAYS);
  const before = cutoff.toISOString().slice(0, 10);
  for (const t of reg.themes) if (!t.manual && t.last_seen && t.last_seen < before) t.active = false;
  return reg;
}

export function allNames(reg: ThemeRegistry): string[] {
  return [...new Set(reg.themes.filter((t) => t.active).flatMap((t) => [t.name, ...t.aliases]))];
}
