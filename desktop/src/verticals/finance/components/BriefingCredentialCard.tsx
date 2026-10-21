/**
 * 研报简报的访问令牌与订阅组 ID(设置页)。
 * 令牌只存本机、只回打码后的样子;环境变量设了就以环境变量为准,页面不能改。
 */
import { useEffect, useState } from "react";
import { EyeOff, KeyRound, Loader2 } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { backend } from "@/lib/backend";
import type { BriefingCredentialStatus } from "@/lib/briefing";

const sourceText = (s: BriefingCredentialStatus | null): string => {
  if (!s) return "读取中…";
  if (s.source === "env") return "由环境变量指定";
  if (s.source === "saved") return "已保存在本机";
  return "未设置";
};

export function BriefingCredentialCard() {
  const [token, setToken] = useState<BriefingCredentialStatus | null>(null);
  const [group, setGroup] = useState<BriefingCredentialStatus | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [groupInput, setGroupInput] = useState("");
  const [busy, setBusy] = useState<"token" | "group" | null>(null);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    let alive = true;
    Promise.all([backend.briefingToken(), backend.briefingGroup()])
      .then(([t, g]) => { if (alive) { setToken(t); setGroup(g); } })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, []);

  const save = async (which: "token" | "group", value: string | null) => {
    setBusy(which); setError(""); setOk("");
    try {
      if (which === "token") {
        setToken(await backend.setBriefingToken(value));
        setTokenInput("");
        setOk(value ? "访问令牌已保存" : "访问令牌已清除");
      } else {
        setGroup(await backend.setBriefingGroup(value));
        setGroupInput("");
        setOk(value ? "订阅组 ID 已保存" : "订阅组 ID 已清除");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <GlassCard>
      <div className="mb-3 flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">研报简报</h3>
        <span className="text-[11px] text-muted-foreground">个人订阅;只保存在本机</span>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
        从你订阅的简报网站浏览器 Cookie 里取访问令牌;组 ID 就是订阅地址里的那串数字。
        令牌只用于本机抓取,不进入 AI,也不会被页面读回。
      </p>

      <div className="space-y-3">
        <div>
          <label className="mb-1 flex flex-wrap items-center gap-2 text-[12px]">
            <span className="font-medium">访问令牌</span>
            <span className="text-[11px] text-muted-foreground">{sourceText(token)}</span>
            {token?.masked && <span className="font-mono text-[11px] text-muted-foreground">{token.masked}</span>}
            {token?.source === "env" && <EyeOff className="h-3 w-3 text-muted-foreground" />}
          </label>
          <div className="flex gap-2">
            <input
              type="password" value={tokenInput} autoComplete="off"
              disabled={token?.source === "env" || busy !== null}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder={token?.source === "env" ? "由环境变量 VRA_BRIEFING_TOKEN 指定" : "粘贴令牌或整段 Cookie"}
              className="min-w-0 flex-1 rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            />
            <button type="button" disabled={busy !== null || token?.source === "env"}
              onClick={() => void save("token", tokenInput.trim() || null)}
              className="inline-flex items-center gap-1 rounded-lg border border-primary/50 bg-primary/10 px-3 py-1.5 text-[12px] font-medium text-primary hover:bg-primary/20 disabled:opacity-50">
              {busy === "token" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}保存
            </button>
            {token?.source === "saved" && (
              <button type="button" disabled={busy !== null} onClick={() => void save("token", null)}
                className="rounded-lg border border-border/60 px-2.5 py-1.5 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-50">
                清除
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="mb-1 flex flex-wrap items-center gap-2 text-[12px]">
            <span className="font-medium">订阅组 ID</span>
            <span className="text-[11px] text-muted-foreground">{sourceText(group)}</span>
            {group?.masked && <span className="font-mono text-[11px] text-muted-foreground">{group.masked}</span>}
          </label>
          <div className="flex gap-2">
            <input
              type="text" value={groupInput} autoComplete="off"
              disabled={group?.source === "env" || busy !== null}
              onChange={(e) => setGroupInput(e.target.value)}
              placeholder={group?.source === "env" ? "由环境变量 VRA_BRIEFING_GROUP 指定" : "例如 12345678901234"}
              className="min-w-0 flex-1 rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            />
            <button type="button" disabled={busy !== null || group?.source === "env"}
              onClick={() => void save("group", groupInput.trim() || null)}
              className="inline-flex items-center gap-1 rounded-lg border border-primary/50 bg-primary/10 px-3 py-1.5 text-[12px] font-medium text-primary hover:bg-primary/20 disabled:opacity-50">
              {busy === "group" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}保存
            </button>
            {group?.source === "saved" && (
              <button type="button" disabled={busy !== null} onClick={() => void save("group", null)}
                className="rounded-lg border border-border/60 px-2.5 py-1.5 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-50">
                清除
              </button>
            )}
          </div>
        </div>
      </div>

      {(error || ok) && (
        <p role={error ? "alert" : "status"} className={`mt-2 text-[11px] ${error ? "text-danger" : "text-success"}`}>
          {error || ok}
        </p>
      )}
      <p className="mt-2 text-[10px] text-muted-foreground">
        远程访问模式下不能在这里修改;令牌存在数据根的 briefing/token.json(仅当前用户可读)。
      </p>
    </GlassCard>
  );
}
