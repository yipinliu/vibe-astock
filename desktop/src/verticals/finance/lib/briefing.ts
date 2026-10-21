/** 研报简报视图的类型与格式化(后端见 orchestrator/src/finance/briefing/)。 */

export interface BriefingTopic {
  topic_id: string; type: string; title: string; author: string; institution: string;
  text: string; create_time: string;
  images: string[]; files: { name: string; url: string }[];
  digests: boolean; likes: number; comments_count: number; reading_count: number;
}
export interface BriefingTheme {
  name: string; mentions: number; key_points: string[]; topic_ids: string[]; institutions: string[];
}
export interface BriefingSignal {
  type: string; text: string; topic_ids: string[]; institutions: string[];
}
export interface BriefingAnalysis {
  schema: number; date: string; scope: "day" | "recent7"; generated_at: string; ai: string;
  topic_ids: string[]; themes: BriefingTheme[]; consensus: string[]; contrarian: string[];
  signals: BriefingSignal[]; risks: string[]; warnings: string[];
}
export interface StockTechFacts {
  date?: string | null; close?: number | null;
  ma5?: number | null; ma10?: number | null; ma20?: number | null; ma60?: number | null;
  ret5?: number | null; ret20?: number | null;
  high60?: number | null; low60?: number | null; from_high?: number | null; from_low?: number | null;
  vol_ratio_5_20?: number | null; bars?: number; volume_unit?: string | null;
}
export interface BriefingStock {
  stock_name: string; stock_code: string; mention_type: string; thesis: string; metrics: string;
  topic_ids: string[]; institutions: string[];
  tech: StockTechFacts | null; tech_error: string | null;
}
export interface BriefingStocks {
  schema: number; date: string; scope: "day" | "recent7"; generated_at: string; ai: string;
  topic_ids: string[]; stocks: BriefingStock[]; warnings: string[];
}
export interface BriefingCredentialStatus {
  source: "env" | "saved" | "none"; masked: string | null; valid: boolean;
}
export interface BriefingState {
  last_sync: string | null; last_error: string | null; fetched_at: string | null; topic_count: number;
}
export interface BriefingView {
  date: string; scope: "day" | "recent7"; today: string; dates: string[];
  topics: BriefingTopic[]; analysis: BriefingAnalysis | null; stocks: BriefingStocks | null;
  stale: boolean; state: BriefingState;
  token: BriefingCredentialStatus; group: BriefingCredentialStatus;
  group_id: string; read_only: boolean;
}

export const fmtBriefingTime = (iso: string): string => {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(iso || "");
  return m ? `${m[1]} ${m[2]}` : (iso || "").slice(0, 16);
};

export const briefPct = (v?: number | null, digits = 1): string =>
  typeof v === "number" && Number.isFinite(v) ? `${v > 0 ? "+" : ""}${(v * 100).toFixed(digits)}%` : "—";

export const briefNum = (v?: number | null, digits = 2): string =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "—";

/** 一只个股的技术读数摘要;没有读数时把原因原样带出来,不写 0。 */
export function techLine(s: BriefingStock): string {
  const t = s.tech;
  if (!t) return s.tech_error || "技术读数没取到";
  const parts = [
    t.close != null ? `收 ${briefNum(t.close)}` : "",
    t.ma20 != null ? `MA20 ${briefNum(t.ma20)}` : "",
    t.ret20 != null ? `20日 ${briefPct(t.ret20)}` : "",
    t.from_high != null ? `距60日高 ${briefPct(t.from_high)}` : "",
    t.vol_ratio_5_20 != null ? `量比 ${briefNum(t.vol_ratio_5_20, 2)}` : "",
  ].filter(Boolean);
  return parts.join(" · ") || "读数不足";
}
