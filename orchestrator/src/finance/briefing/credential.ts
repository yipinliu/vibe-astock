/**
 * 个人订阅简报的访问令牌与订阅组 ID(设置页选填)。
 *
 * 令牌只存在数据根的 briefing/token.json(0600 + Windows ACL);设置接口只回来源和打码后的样子。
 * 环境变量 VRA_BRIEFING_TOKEN / VRA_BRIEFING_GROUP 设了就以它为准,页面不能改。
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { restrictPrivateFile } from "../../fsutil.ts";
import { CredentialError } from "../../saved_credentials.ts";
import type { SavedCredential } from "../../plugin.ts";

export const BRIEFING_TOKEN_VAR = "VRA_BRIEFING_TOKEN";
export const BRIEFING_GROUP_VAR = "VRA_BRIEFING_GROUP";
export const BRIEFING_DIR = "briefing";
export const TOKEN_FILE = path.join(BRIEFING_DIR, "token.json");
export const GROUP_FILE = path.join(BRIEFING_DIR, "group.json");

export class BriefingCredentialError extends CredentialError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "BriefingCredentialError";
  }
}

export interface CredentialStatus {
  source: "env" | "saved" | "none";
  masked: string | null;
  valid: boolean;
}

const TOKEN_RE = /^[A-Za-z0-9._~-]{10,300}$/;
const GROUP_RE = /^\d{6,24}$/;

/** 接受裸令牌或整段 Cookie;只留 zsxq_access_token 的值。 */
export function normalizeBriefingToken(input: string): string {
  let v = String(input ?? "").trim();
  const cookie = /(?:^|;\s*)zsxq_access_token=([^;]+)/i.exec(v);
  if (cookie) v = cookie[1]!.trim();
  else v = v.replace(/^zsxq_access_token=/i, "").trim();
  if (!v) throw new BriefingCredentialError("bad_briefing_token", "简报访问令牌是空的");
  if (!TOKEN_RE.test(v)) throw new BriefingCredentialError("bad_briefing_token", "简报访问令牌的格式不对(只收字母、数字、点、下划线、波浪线和连字符)");
  return v;
}

export function normalizeBriefingGroup(input: string): string {
  const v = String(input ?? "").trim();
  if (!v) throw new BriefingCredentialError("bad_briefing_group", "订阅组 ID 是空的");
  if (!GROUP_RE.test(v)) throw new BriefingCredentialError("bad_briefing_group", "订阅组 ID 应为 6–24 位数字");
  return v;
}

export function maskBriefingToken(v: string): string {
  if (v.length <= 8) return "***";
  return `${v.slice(0, 3)}***${v.slice(-3)}`;
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function savedValue(dataRoot: string, file: string, field: string, normalize: (v: string) => string): string | null {
  const parsed = readJson(path.join(dataRoot, file));
  if (!parsed || typeof parsed[field] !== "string") return null;
  try { return normalize(parsed[field]); } catch { return null; }
}

function savePrivate(dataRoot: string, file: string, body: Record<string, unknown>, input: unknown, normalize: (v: string) => string): void {
  const target = path.join(dataRoot, file);
  if (input === null || (typeof input === "string" && !input.trim())) {
    fs.rmSync(target, { force: true });
    return;
  }
  if (typeof input !== "string") throw new BriefingCredentialError("bad_briefing_credential", "值必须是文字");
  const value = normalize(input);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ ...body, value, saved_at: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  try {
    restrictPrivateFile(tmp);
    fs.renameSync(tmp, target);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

const tokenEnv = (env: NodeJS.ProcessEnv) => String(env[BRIEFING_TOKEN_VAR] ?? "").trim();
const groupEnv = (env: NodeJS.ProcessEnv) => String(env[BRIEFING_GROUP_VAR] ?? "").trim();

function tokenStatus(dataRoot: string, env: NodeJS.ProcessEnv): CredentialStatus {
  const e = tokenEnv(env);
  if (e) {
    let valid = true, masked = maskBriefingToken(e);
    try { masked = maskBriefingToken(normalizeBriefingToken(e)); } catch { valid = false; }
    return { source: "env", masked, valid };
  }
  const saved = savedValue(dataRoot, TOKEN_FILE, "value", normalizeBriefingToken);
  return saved ? { source: "saved", masked: maskBriefingToken(saved), valid: true } : { source: "none", masked: null, valid: false };
}

function tokenValue(dataRoot: string, env: NodeJS.ProcessEnv): string | null {
  const e = tokenEnv(env);
  if (e) { try { return normalizeBriefingToken(e); } catch { return null; } }
  return savedValue(dataRoot, TOKEN_FILE, "value", normalizeBriefingToken);
}

function groupStatus(dataRoot: string, env: NodeJS.ProcessEnv): CredentialStatus {
  const e = groupEnv(env);
  if (e) { try { return { source: "env", masked: normalizeBriefingGroup(e), valid: true }; } catch { return { source: "env", masked: null, valid: false }; } }
  const saved = savedValue(dataRoot, GROUP_FILE, "value", normalizeBriefingGroup);
  return saved ? { source: "saved", masked: saved, valid: true } : { source: "none", masked: null, valid: false };
}

function groupValue(dataRoot: string, env: NodeJS.ProcessEnv): string | null {
  const e = groupEnv(env);
  if (e) { try { return normalizeBriefingGroup(e); } catch { return null; } }
  return savedValue(dataRoot, GROUP_FILE, "value", normalizeBriefingGroup);
}

export const BRIEFING_TOKEN_CREDENTIAL: SavedCredential = {
  id: "briefing-token",
  envVar: BRIEFING_TOKEN_VAR,
  bodyField: "token",
  remoteLockedMessage: "远程访问模式下不能在页面里修改简报访问令牌：请部署者用环境变量 VRA_BRIEFING_TOKEN 设置后重启",
  status: (dataRoot, env) => tokenStatus(dataRoot, env),
  value: (dataRoot, env) => tokenValue(dataRoot, env),
  save: (dataRoot, input, env) => {
    if (tokenEnv(env)) throw new BriefingCredentialError("briefing_token_env_locked", "简报访问令牌已由环境变量 VRA_BRIEFING_TOKEN 指定；要改请改这个变量");
    savePrivate(dataRoot, TOKEN_FILE, {}, input, normalizeBriefingToken);
    return tokenStatus(dataRoot, env);
  },
};

export const BRIEFING_GROUP_CREDENTIAL: SavedCredential = {
  id: "briefing-group",
  envVar: BRIEFING_GROUP_VAR,
  bodyField: "group_id",
  remoteLockedMessage: "远程访问模式下不能在页面里修改订阅组 ID：请部署者用环境变量 VRA_BRIEFING_GROUP 设置后重启",
  status: (dataRoot, env) => groupStatus(dataRoot, env),
  value: (dataRoot, env) => groupValue(dataRoot, env),
  save: (dataRoot, input, env) => {
    if (groupEnv(env)) throw new BriefingCredentialError("briefing_group_env_locked", "订阅组 ID 已由环境变量 VRA_BRIEFING_GROUP 指定；要改请改这个变量");
    savePrivate(dataRoot, GROUP_FILE, {}, input, normalizeBriefingGroup);
    return groupStatus(dataRoot, env);
  },
};

/** 视图要的订阅组 ID:环境变量优先,其次设置页保存的。 */
export const readBriefingGroup = (dataRoot: string, env: NodeJS.ProcessEnv = process.env): string | null => groupValue(dataRoot, env);
/** 视图判断令牌有没有配好(不取原文)。 */
export const briefingTokenConfigured = (dataRoot: string, env: NodeJS.ProcessEnv = process.env): boolean => tokenValue(dataRoot, env) !== null;
