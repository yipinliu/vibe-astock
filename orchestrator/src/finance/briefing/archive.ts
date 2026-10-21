/**
 * 个人订阅简报的本地归档(只在本机,不进 git、不进页面上下文)。
 *
 * 抓取工具只返回最新一批 topic;这里按 topic 日期合并成 `<dataRoot>/briefing/archive/<date>.json`,
 * 保留 7 天。每次写都用 0600 + Windows ACL 收紧;令牌只在取数子进程的 env 里出现,不落在这里。
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { readJsonIfExists, restrictPrivateFile } from "../../fsutil.ts";
import { localClock } from "../../notify.ts";
import { runTool, ServiceError, type ServiceContext } from "../../service.ts";
import { cleanLine, sanitizeUntrustedText } from "../ai_audit.ts";
import { BRIEFING_DIR } from "./credential.ts";

export const ARCHIVE_SCHEMA = 1;
export const KEEP_DAYS = 7;
export const DETAIL_MAX = 20_000;
/** 产品统一按北京时间归档;不 import schedule.ts,避免和定时任务互相引用。 */
const TZ = "Asia/Shanghai";

export interface BriefingTopic {
  topic_id: string; type: string; title: string; author: string; institution: string;
  text: string; create_time: string;
  images: string[]; files: { name: string; url: string }[];
  digests: boolean; likes: number; comments_count: number; reading_count: number;
}
export interface BriefingDay {
  schema: 1; date: string; updated_at: string; topics: BriefingTopic[];
}
export interface BriefingState {
  last_sync: string | null; last_error: string | null; fetched_at: string | null; topic_count: number;
}
export interface SyncResult { fetched: number; dates: string[]; fetched_at: string | null }

const dirOf = (dataRoot: string) => path.join(dataRoot, BRIEFING_DIR);
export const archiveDir = (dataRoot: string) => path.join(dirOf(dataRoot), "archive");
export const statePath = (dataRoot: string) => path.join(dirOf(dataRoot), "state.json");

/** 同目录临时文件(创建时 0600)写完后收紧 ACL 再改名。 */
function writePrivateJson(file: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  try {
    restrictPrivateFile(tmp);
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

const intOr0 = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;

function normalizeTopic(raw: unknown): BriefingTopic | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const topicId = cleanLine(r.topic_id, 100);
  if (!topicId) return null;
  const images = Array.isArray(r.images)
    ? r.images.filter((x): x is string => typeof x === "string").map((x) => cleanLine(x, 500)).filter(Boolean).slice(0, 20)
    : [];
  const files = Array.isArray(r.files)
    ? r.files.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x))
      .map((f) => ({ name: cleanLine(f.name, 200), url: cleanLine(f.url, 500) }))
      .filter((f) => f.name || f.url).slice(0, 20)
    : [];
  return {
    topic_id: topicId,
    type: cleanLine(r.type, 20) || "talk",
    title: cleanLine(r.title, 300),
    author: cleanLine(r.author, 80),
    institution: cleanLine(r.institution, 40),
    text: sanitizeUntrustedText(r.text, DETAIL_MAX),
    create_time: cleanLine(r.create_time, 40),
    images, files,
    digests: r.digests === true,
    likes: intOr0(r.likes), comments_count: intOr0(r.comments_count), reading_count: intOr0(r.reading_count),
  };
}

function dayOf(topic: BriefingTopic, fallback: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(topic.create_time);
  return m && m[1]! <= fallback ? m[1]! : fallback;
}

function crawlResult(raw: unknown): { topics: BriefingTopic[]; fetched_at: string | null } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ServiceError("briefing_sync_failed", "简报抓取没有返回结果");
  }
  const r = raw as Record<string, unknown>;
  if (r.ok !== true) throw new ServiceError("briefing_sync_failed", cleanLine(r.error, 300) || "简报抓取失败");
  const result = r.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new ServiceError("briefing_sync_failed", "简报抓取的结果形状不对");
  }
  const res = result as Record<string, unknown>;
  const topics = Array.isArray(res.topics)
    ? res.topics.map(normalizeTopic).filter((t): t is BriefingTopic => !!t)
    : [];
  return { topics, fetched_at: typeof res.fetched_at === "string" ? res.fetched_at : null };
}

function readDayFile(dataRoot: string, date: string): BriefingDay | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = readJsonIfExists<BriefingDay>(path.join(archiveDir(dataRoot), `${date}.json`));
  if (!parsed || parsed.schema !== ARCHIVE_SCHEMA || parsed.date !== date || !Array.isArray(parsed.topics)) return null;
  return parsed;
}

function writeDay(dataRoot: string, date: string, topics: BriefingTopic[], nowIso: string): void {
  const merged = new Map<string, BriefingTopic>();
  for (const t of topics) merged.set(t.topic_id, t);
  const sorted = [...merged.values()].sort((a, b) => b.create_time.localeCompare(a.create_time));
  writePrivateJson(path.join(archiveDir(dataRoot), `${date}.json`), {
    schema: ARCHIVE_SCHEMA, date, updated_at: nowIso, topics: sorted,
  } satisfies BriefingDay);
}

function pruneDir(dir: string, cutoff: string): void {
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) {
    const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
    if (m && m[1]! < cutoff) {
      try { fs.rmSync(path.join(dir, name), { force: true }); } catch { /* 删不掉就留着,下次再试 */ }
    }
  }
}

function prune(dataRoot: string, today: string): void {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - (KEEP_DAYS - 1));
  const day = cutoff.toISOString().slice(0, 10);
  for (const sub of ["archive", "analysis", "stocks"]) pruneDir(path.join(dirOf(dataRoot), sub), day);
}

export function readState(dataRoot: string): BriefingState {
  const state = readJsonIfExists<BriefingState>(statePath(dataRoot));
  return state && typeof state === "object"
    ? { last_sync: state.last_sync ?? null, last_error: state.last_error ?? null, fetched_at: state.fetched_at ?? null, topic_count: intOr0(state.topic_count) }
    : { last_sync: null, last_error: null, fetched_at: null, topic_count: 0 };
}

type RunTool = (ctx: ServiceContext, name: string, body: unknown, signal?: AbortSignal) => Promise<unknown>;
let syncing: Promise<SyncResult> | null = null;

/** 抓最新一批并合并进本机归档。同一时刻只跑一次;并发调用共用同一个结果。 */
export function syncBriefings(ctx: ServiceContext, groupId: string, signal?: AbortSignal, run: RunTool = runTool): Promise<SyncResult> {
  if (syncing) return syncing;
  syncing = (async () => {
    const now = new Date();
    const today = localClock(now, TZ).day;
    try {
      const raw = await run(ctx, "briefing_crawl", { group_id: groupId, count: 30 }, signal);
      const { topics, fetched_at } = crawlResult(raw);
      const nowIso = now.toISOString();
      const byDay = new Map<string, BriefingTopic[]>();
      for (const t of topics) {
        const d = dayOf(t, today);
        if (!byDay.has(d)) byDay.set(d, []);
        byDay.get(d)!.push(t);
      }
      for (const [d, list] of byDay) {
        const existing = readDayFile(ctx.dataRoot, d)?.topics ?? [];
        writeDay(ctx.dataRoot, d, [...existing, ...list], nowIso);
      }
      prune(ctx.dataRoot, today);
      const state: BriefingState = { last_sync: nowIso, last_error: null, fetched_at, topic_count: topics.length };
      writePrivateJson(statePath(ctx.dataRoot), state);
      return { fetched: topics.length, dates: [...byDay.keys()].sort(), fetched_at };
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
      try { writePrivateJson(statePath(ctx.dataRoot), { ...readState(ctx.dataRoot), last_error: reason }); } catch { /* 状态写不了不掩盖原错误 */ }
      throw error;
    }
  })().finally(() => { syncing = null; });
  return syncing;
}

export function listArchiveDates(dataRoot: string): string[] {
  let names: string[] = [];
  try { names = fs.readdirSync(archiveDir(dataRoot)); } catch { return []; }
  return names.map((n) => /^(\d{4}-\d{2}-\d{2})\.json$/.exec(n)?.[1]).filter((x): x is string => !!x).sort().reverse();
}

export function readBriefingDay(dataRoot: string, date?: string | null): BriefingDay | null {
  const d = date || listArchiveDates(dataRoot)[0];
  return d ? readDayFile(dataRoot, d) : null;
}

/** 某天 / 近 7 天的 topic;近 7 天按日期倒序合并,最多 80 条。 */
export function readTopicsForScope(dataRoot: string, date: string | null, scope: "day" | "recent7"): BriefingTopic[] {
  const latest = listArchiveDates(dataRoot);
  const base = date || latest[0];
  if (!base) return [];
  if (scope === "day") return readBriefingDay(dataRoot, base)?.topics ?? [];
  const cutoff = new Date(`${base}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - (KEEP_DAYS - 1));
  const from = cutoff.toISOString().slice(0, 10);
  const days = latest.filter((d) => d <= base && d >= from).sort().reverse();
  const out: BriefingTopic[] = [];
  const seen = new Set<string>();
  for (const d of days) {
    for (const t of readBriefingDay(dataRoot, d)?.topics ?? []) {
      if (!seen.has(t.topic_id)) { seen.add(t.topic_id); out.push(t); }
    }
  }
  return out.slice(0, 80);
}

/** 供分析/个股视图写自己的结果;和归档同一套 0600 写入。 */
export function writeBriefingJson(dataRoot: string, rel: string, obj: unknown): void {
  if (!/^(analysis|stocks)\/[0-9]{4}-[0-9]{2}-[0-9]{2}\.json$/.test(rel)) {
    throw new ServiceError("bad_briefing_path", "简报结果的路径不合法");
  }
  writePrivateJson(path.join(dirOf(dataRoot), rel), obj);
}

export function readBriefingJson<T>(dataRoot: string, rel: string): T | null {
  if (!/^(analysis|stocks)\/[0-9]{4}-[0-9]{2}-[0-9]{2}\.json$/.test(rel)) return null;
  return readJsonIfExists<T>(path.join(dirOf(dataRoot), rel));
}
