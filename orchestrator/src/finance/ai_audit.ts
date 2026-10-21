/**
 * 一次 AI 解读的共用护栏:外部文本清洗、JSON 解析、理财红线、数字落地。
 * 只给垂类视图用;不改变 review.ts 那套分段复核。
 */
import { FINANCE_GATE } from "./gate_rules.ts";
import { claimTokens } from "../number_fidelity.ts";

// 用字符串构造,避免源码里出现不可见控制字符。
const CONTROL_CHARS = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]+", "g");

export function sanitizeUntrustedText(v: unknown, max = 4000): string {
  return String(v ?? "")
    .replace(CONTROL_CHARS, " ")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, max);
}

/** 模型常把 JSON 包在 ```json 里,或前后带一句说明;取第一个 { 到最后一个 }。 */
export function parseJsonReply(raw: string): unknown {
  const text = String(raw ?? "").replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** 命中产品红线(买卖建议 / 目标价 / 择时)时返回命中的规则名;没命中返回 null。 */
export function violatesFinanceGate(text: string): string | null {
  const t = String(text ?? "");
  for (const p of FINANCE_GATE.patterns) if (t.includes(p)) return p;
  for (const r of FINANCE_GATE.regexps) if (r.re.test(t)) return r.name;
  return null;
}

/** 输出里落地不了的数:allowed 里没有同量级的值。返回原文写法的清单。 */
export function ungroundedNumbers(text: string, allowed: number[]): string[] {
  const pool = allowed.filter((n) => Number.isFinite(n));
  const out: string[] = [];
  for (const tok of claimTokens(String(text ?? ""))) {
    const ok = pool.some((a) => {
      const tolerance = Math.max(0.011, Math.abs(a) * 0.01);
      return Math.abs(a - tok.n) <= tolerance;
    });
    if (!ok) out.push(String(tok.raw).trim());
  }
  return [...new Set(out)];
}

/** 从外部原文里收集允许出现的数(摘要只能照抄或复述这些数)。 */
export function numbersIn(text: string): number[] {
  return claimTokens(String(text ?? "")).map((t) => t.n);
}

export function cleanLine(v: unknown, max: number): string {
  return sanitizeUntrustedText(v, max).replace(/\s+/g, " ").trim();
}

export function asStringList(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string")
    .map((x) => cleanLine(x, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}
