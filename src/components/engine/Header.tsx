import { useState } from "react";
import { Zap, Bell, Settings, Wifi, WifiOff, Power, Key, X, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import type { ConnectionStatus } from "@/services/derivWebSocket";

interface HeaderProps {
  marketCount: number;
  wsStatus: ConnectionStatus;
  engineRunning?: boolean;
  onEngineToggle?: () => void;
}

export function Header({ marketCount, wsStatus, engineRunning, onEngineToggle }: HeaderProps) {
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [newToken, setNewToken] = useState("");
  const [tokenStatus, setTokenStatus] = useState<"idle" | "testing" | "valid" | "invalid">("idle");
  const [tokenInfo, setTokenInfo] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const wsLabel =
    wsStatus === "connected" ? "WS CONNECTED"
    : wsStatus === "connecting" ? "CONNECTING..."
    : wsStatus === "error" ? "WS ERROR"
    : "DISCONNECTED";

  const wsColor =
    wsStatus === "connected" ? "text-signal-buy"
    : wsStatus === "error" ? "text-signal-sell"
    : "text-warning";

  const testToken = async () => {
    if (!newToken.trim()) { toast.error("Enter a token first"); return; }
    setTokenStatus("testing");
    setTokenInfo("");
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/deriv-trading?action=test_token`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify({ token: newToken.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.valid) {
        setTokenStatus("valid");
        setTokenInfo(`✓ ${data.loginid} (${data.is_virtual ? "Demo" : "Live"}) — ${data.currency} ${data.balance}`);
      } else {
        setTokenStatus("invalid");
        setTokenInfo(data.error || "Token is invalid");
      }
    } catch (err) {
      setTokenStatus("invalid");
      setTokenInfo("Network error — check connection");
    }
  };

  const saveToken = async () => {
    if (tokenStatus !== "valid") { toast.error("Test the token first"); return; }
    setSaving(true);
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/deriv-trading?action=update_token`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify({ token: newToken.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success("API token updated successfully!");
        setTokenDialogOpen(false);
        setNewToken("");
        setTokenStatus("idle");
        setTokenInfo("");
      } else {
        toast.error(data.error || "Failed to save token");
      }
    } catch {
      toast.error("Network error saving token");
    } finally {
      setSaving(false);
    }
  };

  return (
    <header className="border-b border-engine-border bg-engine-bg/80 backdrop-blur-xl sticky top-0 z-50">
      <div className="max-w-[1600px] mx-auto px-4 md:px-6 h-14 md:h-16 flex items-center justify-between">
        <div className="flex items-center gap-3 md:gap-4">
          <div className="w-7 h-7 md:w-8 md:h-8 bg-signal-buy rounded-md flex items-center justify-center shadow-lg shadow-signal-buy/20">
            <Zap className="text-engine-bg fill-engine-bg" size={14} />
          </div>
          <div className="flex flex-col">
            <h1 className="text-xs md:text-base font-black tracking-tight leading-none text-engine-text-primary">
              DNN DERIV ENGINE
            </h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[7px] md:text-[9px] text-signal-buy font-mono font-bold px-1 py-0.5 bg-signal-buy-bg rounded border border-signal-buy/20 uppercase tracking-widest">
                v5.0 SMC+MTF
              </span>
              <div className="hidden sm:flex items-center gap-1.5 text-[8px] text-engine-text-dim font-mono">
                {wsStatus === "connected" ? (
                  <div className="status-dot-healthy" />
                ) : wsStatus === "error" ? (
                  <div className="status-dot-error" />
                ) : (
                  <div className="status-dot-warning" />
                )}
                LIVE FEED
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          {/* Engine Start/Stop Button */}
          {onEngineToggle && (
            <button
              onClick={onEngineToggle}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[9px] font-bold uppercase tracking-widest transition-all border ${
                engineRunning
                  ? "bg-signal-buy/10 border-signal-buy/30 text-signal-buy hover:bg-signal-buy/20"
                  : "bg-signal-sell/10 border-signal-sell/30 text-signal-sell hover:bg-signal-sell/20"
              }`}
            >
              <Power size={12} className={engineRunning ? "animate-pulse" : ""} />
              <span className="hidden sm:inline">{engineRunning ? "ENGINE ON" : "ENGINE OFF"}</span>
              <span className="sm:hidden">{engineRunning ? "ON" : "OFF"}</span>
            </button>
          )}

          <div className="hidden md:flex items-center gap-6 text-[10px] font-mono text-engine-text-muted mr-2">
            <div className="flex flex-col items-end">
              <span className="text-[8px] text-engine-text-dim uppercase tracking-widest">Deriv WS</span>
              <span className={`${wsColor} font-bold flex items-center gap-1`}>
                {wsStatus === "connected" ? <Wifi size={10} /> : <WifiOff size={10} />}
                {wsLabel}
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[8px] text-engine-text-dim uppercase tracking-widest">Markets</span>
              <span className="text-engine-text-secondary font-bold">{marketCount} ACTIVE</span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {/* API Token Button */}
            <Dialog open={tokenDialogOpen} onOpenChange={setTokenDialogOpen}>
              <DialogTrigger asChild>
                <button className="p-2 hover:bg-engine-surface-hover rounded-md transition-all group" title="Update Deriv API Token">
                  <Key size={16} className="text-engine-text-muted group-hover:text-signal-buy" />
                </button>
              </DialogTrigger>
              <DialogContent className="bg-[hsl(var(--engine-bg))] border-engine-border text-engine-text-primary max-w-md">
                <DialogHeader>
                  <DialogTitle className="text-sm font-bold uppercase tracking-widest text-engine-text-primary flex items-center gap-2">
                    <Key size={16} className="text-signal-buy" />
                    Update Deriv API Token
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-2">
                  <p className="text-[10px] text-engine-text-muted leading-relaxed">
                    Enter your Deriv API token to switch accounts. Get one from{" "}
                    <a href="https://app.deriv.com/account/api-token" target="_blank" rel="noopener" className="text-signal-buy underline">
                      app.deriv.com/account/api-token
                    </a>
                    . Required scopes: <b>Admin + Trade + Read</b>.
                  </p>

                  <div className="space-y-2">
                    <label className="text-[9px] text-engine-text-dim uppercase tracking-widest font-bold">API Token</label>
                    <Input
                      type="password"
                      value={newToken}
                      onChange={(e) => { setNewToken(e.target.value); setTokenStatus("idle"); setTokenInfo(""); }}
                      placeholder="Paste your Deriv API token here..."
                      className="engine-input text-xs font-mono"
                    />
                  </div>

                  {tokenInfo && (
                    <div className={`flex items-start gap-2 p-3 rounded-md text-[10px] font-mono border ${
                      tokenStatus === "valid"
                        ? "bg-signal-buy/5 border-signal-buy/20 text-signal-buy"
                        : "bg-signal-sell/5 border-signal-sell/20 text-signal-sell"
                    }`}>
                      {tokenStatus === "valid" ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                      <span>{tokenInfo}</span>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={testToken}
                      disabled={!newToken.trim() || tokenStatus === "testing"}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-[9px] font-bold uppercase tracking-widest border border-engine-border bg-engine-surface hover:bg-engine-surface-hover text-engine-text-primary transition-all disabled:opacity-40"
                    >
                      {tokenStatus === "testing" ? <Loader2 size={10} className="animate-spin" /> : null}
                      Test Token
                    </button>
                    <button
                      onClick={saveToken}
                      disabled={tokenStatus !== "valid" || saving}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-[9px] font-bold uppercase tracking-widest bg-signal-buy text-engine-bg hover:opacity-90 transition-all disabled:opacity-40"
                    >
                      {saving ? <Loader2 size={10} className="animate-spin" /> : null}
                      Save & Activate
                    </button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <button className="p-2 hover:bg-engine-surface-hover rounded-md transition-all group">
              <Bell size={16} className="text-engine-text-muted group-hover:text-signal-buy" />
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Status Bar */}
      <div className="md:hidden flex items-center justify-between px-4 py-1.5 bg-signal-buy-bg border-t border-engine-border text-[8px] font-mono">
        <div className={`flex items-center gap-1.5 ${wsColor}`}>
          {wsStatus === "connected" ? <div className="status-dot-healthy" /> : <div className="status-dot-warning" />}
          <span>{wsLabel}</span>
        </div>
        <div className="flex items-center gap-1.5 text-engine-text-dim">
          <span>{engineRunning ? "🟢 ENGINE ON" : "🔴 ENGINE OFF"} · {marketCount} MARKETS</span>
        </div>
      </div>
    </header>
  );
}
