/**
 * 跌停深化:天地面、跌停趋势、高位龙头跌停、换手偏高线索、风险等级。
 * 只摆已发生的读数和缺口;缺失日不写成 0,风险未知不写成绿灯。
 */
import { useState } from "react";
import { AlertTriangle, ChevronDown, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Section } from "./FactsPanels";
import { finite, hhmm, pctColor, safeArray, signed } from "./format";
import type { LimitDownLeader, LimitDownPry, LimitDownResult, LimitDownSky, LimitDownTrend } from "./types";

const RISK: Record<LimitDownResult["risk_level"], { label: string; cls: string; box: string }> = {
  red: { label: "红色 · 风险高", cls: "text-danger", box: "border-danger/40 bg-danger/10" },
  yellow: { label: "黄色 · 需警惕", cls: "text-warning", box: "border-warning/40 bg-warning/10" },
  green: { label: "绿色 · 正常", cls: "text-success", box: "border-success/40 bg-success/10" },
  unknown: { label: "未知 · 关键输入没取到", cls: "text-muted-foreground", box: "border-border/60 bg-muted/20" },
};

const pctText = (v: number | null | undefined) => {
  const n = finite(v);
  return n == null ? "—" : `${n.toFixed(1)}%`;
};

function Big({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <div className="min-w-[7rem] flex-1 rounded-lg border border-border px-3 py-2">
      <div className={cn("font-mono text-xl font-bold tabular-nums", tone)}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function Trend({ t, label }: { t: LimitDownTrend | null; label: string }) {
  if (!t) {
    return (
      <div className="min-w-[7rem] flex-1 rounded-lg border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
        {label}均值没算出来(历史跌停池缺数)
      </div>
    );
  }
  const up = t.delta > 0;
  return (
    <div className="min-w-[7rem] flex-1 rounded-lg border border-border px-3 py-2">
      <div className="font-mono text-sm font-bold tabular-nums">{t.avg.toFixed(2)} 只</div>
      <div className="text-[11px] text-muted-foreground">{label}均值</div>
      <div className={cn("text-[11px] tabular-nums", up ? "text-danger" : t.delta < 0 ? "text-success" : "text-muted-foreground")}>
        {up ? "高于" : t.delta < 0 ? "低于" : "持平"} 均值 {up ? "+" : ""}{t.delta.toFixed(2)} 只
        {t.ratio != null ? ` · ${t.ratio.toFixed(2)} 倍` : ""}
      </div>
    </div>
  );
}

export function LimitDownPanel({ r }: { r: LimitDownResult }) {
  const [missingOpen, setMissingOpen] = useState(false);
  const risk = RISK[r.risk_level] ?? RISK.unknown;
  const missingDays = safeArray<{ date: string; reason: string }>(r.history_missing_days);
  const sky = safeArray<LimitDownSky>(r.sky_to_ground);
  const leaders = safeArray<LimitDownLeader>(r.leader_dt);
  const pry = safeArray<LimitDownPry>(r.pry_open_candidates);

  return (
    <Section
      icon={TrendingDown}
      title="跌停深化"
      hint="跌停不只是计数项:昨天封住涨停的今天跌停(天地面)、高位连板股跌停、跌停家数明显高于前几日均值,含义完全不同。风险等级只是从这些已发生的读数推出来的规则结果,不是预测。"
      available={r.available}
      reason={r.reason}
    >
      <div className={cn("mb-3 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2", risk.box)}>
        <div className={cn("text-sm font-bold", risk.cls)}>{risk.label}</div>
        <div className="text-[11px] text-muted-foreground">风险计分 {r.risk_score}</div>
        {r.risk_level === "unknown" && (
          <div className="text-[11px] text-muted-foreground">前一交易日涨停池没取到时,天地面和龙头跌停无法判断,不能给绿灯。</div>
        )}
        {safeArray<string>(r.risk_reasons).length > 0 && (
          <div className="text-[11px] text-muted-foreground">依据:{r.risk_reasons.join(" · ")}</div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Big value={`${r.dt_count}`} label="当日跌停(家)" tone="text-success" />
        <Trend t={r.trend_5d} label="5 日" />
        <Trend t={r.trend_20d} label="20 日" />
        <Big value={`${r.sky_to_ground_count}`} label="天地面(家)" tone={r.sky_to_ground_count > 0 ? "text-danger" : undefined} />
        <Big value={`${r.leader_dt_count}`} label="高位龙头跌停(家)" tone={r.leader_dt_count > 0 ? "text-danger" : undefined} />
        <Big value={`${r.pry_open_count}`} label="换手偏高(家)" />
      </div>

      {missingDays.length > 0 && (
        <div className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            历史跌停池有 {missingDays.length} 个交易日没取到；这些日子的家数没有当成 0,5/20 日均值因此可能算不出来。
            <button type="button" onClick={() => setMissingOpen((v) => !v)} className="ml-auto inline-flex items-center gap-0.5 underline-offset-2 hover:underline">
              看是哪几天 <ChevronDown className={cn("h-3 w-3 transition-transform", missingOpen && "rotate-180")} />
            </button>
          </div>
          {missingOpen && (
            <ul className="mt-1.5 space-y-0.5">
              {missingDays.slice(0, 30).map((m) => <li key={m.date}>{m.date}：{m.reason || "跌停池没取到"}</li>)}
              {missingDays.length > 30 && <li>其余 {missingDays.length - 30} 天略。</li>}
            </ul>
          )}
        </div>
      )}

      {sky.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-1 text-[12px] font-semibold text-foreground">天地面 · 昨日涨停、今日跌停</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] tabular-nums">
              <thead className="text-[11px] text-muted-foreground">
                <tr>{["名称", "代码", "昨日板位", "今日", "换手", "连续跌停", "最后跌停"].map((h) => <th key={h} className="whitespace-nowrap px-1.5 py-1 text-left font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {sky.map((x) => (
                  <tr key={x.code} className="border-t border-border/40">
                    <td className="px-1.5 py-1 font-semibold">{x.name}</td>
                    <td className="px-1.5 py-1 font-mono text-muted-foreground">{x.code}</td>
                    <td className="px-1.5 py-1">{x.prev_label || `${x.prev_boards}板`}</td>
                    <td className={cn("px-1.5 py-1 font-semibold", pctColor(x.ret))}>{signed(x.ret)}</td>
                    <td className="px-1.5 py-1">{pctText(x.turnover)}</td>
                    <td className="px-1.5 py-1">{x.consec_dt != null ? `${x.consec_dt} 天` : "—"}</td>
                    <td className="px-1.5 py-1 font-mono text-muted-foreground">{hhmm(x.last_seal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {leaders.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-1 text-[12px] font-semibold text-foreground">高位龙头跌停 · 昨日连板高度 ≥3</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] tabular-nums">
              <thead className="text-[11px] text-muted-foreground">
                <tr>{["名称", "代码", "昨日高度", "今日", "连续跌停"].map((h) => <th key={h} className="whitespace-nowrap px-1.5 py-1 text-left font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {leaders.map((x) => (
                  <tr key={x.code} className="border-t border-border/40">
                    <td className="px-1.5 py-1 font-semibold">{x.name}</td>
                    <td className="px-1.5 py-1 font-mono text-muted-foreground">{x.code}</td>
                    <td className="px-1.5 py-1">{x.label || `${x.boards}板`}</td>
                    <td className={cn("px-1.5 py-1 font-semibold", pctColor(x.ret))}>{signed(x.ret)}</td>
                    <td className="px-1.5 py-1">{x.consec_dt != null ? `${x.consec_dt} 天` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pry.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-1 text-[12px] font-semibold text-foreground">换手偏高的跌停股 · 只是线索，不是确认翘板</h4>
          <div className="flex flex-wrap gap-1.5">
            {pry.map((x) => (
              <span key={x.code} className="rounded-md border border-border px-2 py-1 text-[11px]">
                <b>{x.name}</b> <span className="font-mono text-muted-foreground">{x.code}</span>
                <span className="ml-1 tabular-nums">换手 {pctText(x.turnover)}</span>
                <span className={cn("ml-1 tabular-nums", pctColor(x.ret))}>{signed(x.ret)}</span>
                {x.consec_dt != null && <span className="ml-1 text-muted-foreground">连续 {x.consec_dt} 天</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        口径:跌停池明细取东财;5/20 日均值逐日取跌停池,缺失日不当 0;换手率 ≥10% 只作线索,
        没有逐股前 5 日成交额,不写成确认翘板。{r.note}
      </p>
    </Section>
  );
}
