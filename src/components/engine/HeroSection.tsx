import { useEffect, useState, useMemo } from "react";
import { Activity, BarChart3, TrendingUp, Zap, Target, Clock, Play, Check, Loader2 } from "lucide-react";
import type { MarketStatus, Signal } from "@/types/engine";
import { SYMBOLS, TRADE_DURATION_LIVE } from "@/types/engine";

interface HeroSectionProps {
  status: MarketStatus[];
  signals: Signal[];
  wsStatus: string;
  onQuickTrade?: (params: { accountType: "demo" | "live"; symbol: string; direction: "BUY" | "SELL" }) => void;
  quickTradeLoading?: boolean;
  quickTradeExecuted?: boolean;
  tradeOpenedAt?: number | null;
  tradeResult?: { result: "WIN" | "LOSS" | "PENDING"; profit: number } | null;
}

export function HeroSection({
  status, signals, wsStatus, onQuickTrade, quickTradeLoading,
  quickTradeExecuted, tradeOpenedAt, tradeResult,
}: HeroSectionProps) {
  const [tick, setTick] = useState(0);
  const [quickTradeAccount, setQuickTradeAccount] = useState<"demo" | "live">("demo");
  const [countdown, setCountdown] = useState<string>("");

  useEffect(() => {
    const t = setInterval(() => setTick((p) => p + 1), 3000);
    return () => clearInterval(t);
  }, []);

  // Countdown timer for active trade
  useEffect(() => {
    if (!tradeOpenedAt || (tradeResult && tradeResult.result !== "PENDING")) {
      setCountdown("");
      return;
    }

    const tradeDurationMs = TRADE_DURATION_LIVE * 60 * 1000;
    const update = () => {
      const remaining = tradeDurationMs - (Date.now() - tradeOpenedAt);
      if (remaining <= 0) {
        setCountdown("Settling...");
        return;
      }
      const min = Math.floor(remaining / 60000);
      const sec = Math.floor((remaining % 60000) / 1000);
      setCountdown(`${min}:${sec.toString().padStart(2, "0")}`);
    };
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [tradeOpenedAt, tradeResult]);

  const stats = useMemo(() => {
    const activeMarkets = status.filter((s) => s.lastPrice > 0).length;
    const totalMarkets = Object.keys(SYMBOLS).length;
    const upCount = status.filter((s) => s.direction === "up").length;
    const downCount = status.filter((s) => s.direction === "down").length;
    const bullBear = activeMarkets > 0
      ? ((upCount / Math.max(upCount + downCount, 1)) * 100).toFixed(0)
      : "—";

    const latestSignal = signals[0] || null;
    const buySignals = signals.filter((s) => s.type === "BUY").length;
    const sellSignals = signals.filter((s) => s.type === "SELL").length;
    const avgScore = signals.length > 0
      ? (signals.reduce((a, s) => a + (s.score || 0), 0) / signals.length).toFixed(1)
      : "—";

    return { activeMarkets, totalMarkets, upCount, downCount, bullBear, latestSignal, buySignals, sellSignals, avgScore };
  }, [status, signals]);

  const signalAge = useMemo(() => {
    if (!stats.latestSignal?.time) return "";
    const diff = Date.now() - new Date(stats.latestSignal.time).getTime();
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return `${Math.floor(diff / 3600000)}h ago`;
  }, [stats.latestSignal, tick]);

  const isBuy = stats.latestSignal?.type === "BUY";
  const isTradeActive = quickTradeExecuted && tradeResult?.result === "PENDING";
  const isTradeSettled = tradeResult && tradeResult.result !== "PENDING";

  const handleQuickTrade = () => {
    if (!stats.latestSignal || !onQuickTrade || isTradeActive) return;
    onQuickTrade({
      accountType: quickTradeAccount,
      symbol: stats.latestSignal.symbol,
      direction: stats.latestSignal.type,
    });
  };

  return (
    <section className="relative overflow-hidden border-b border-engine-border">
      <div className="absolute inset-0 bg-[hsl(var(--engine-bg))]" />
      <div className="absolute inset-0 bg-gradient-to-br from-[hsl(var(--signal-buy)/0.04)] via-transparent to-[hsl(var(--signal-sell)/0.03)]" />
      <div className="absolute top-0 left-1/3 w-[500px] h-[250px] bg-[hsl(var(--signal-buy)/0.03)] rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[300px] h-[200px] bg-[hsl(var(--signal-sell)/0.02)] rounded-full blur-[80px] pointer-events-none" />

      <div className="relative max-w-[1600px] mx-auto px-6 py-6 md:py-8">
        {/* Status bar */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex items-center gap-2 px-3 py-1 rounded-full border border-[hsl(var(--signal-buy)/0.25)] bg-[hsl(var(--signal-buy)/0.08)]">
            <div className={`w-1.5 h-1.5 rounded-full ${wsStatus === "connected" ? "bg-signal-buy animate-pulse" : "bg-signal-sell"}`} />
            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-signal-buy font-mono">
              {wsStatus === "connected" ? "LIVE" : "OFFLINE"} · {stats.activeMarkets} MARKETS
            </span>
          </div>
          <span className="hidden sm:inline text-[9px] text-engine-text-dim font-mono tracking-widest">
            5-MIN SCALPING · MULTI-SYMBOL · REAL-TIME
          </span>
        </div>

        {/* Main row: headline + signal card */}
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5 mb-6">
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl md:text-3xl font-black tracking-tight text-engine-text-primary leading-tight">
              Synthetic Index
              <span className="text-signal-buy"> Command Center</span>
            </h2>
            <p className="text-[11px] text-engine-text-muted mt-2 max-w-xl leading-relaxed font-mono">
              Advanced algorithmic trading engine for Volatility Indices. Real-time Smart Money Concepts &amp; technical analysis across{" "}
              <span className="text-engine-text-secondary font-bold">{stats.totalMarkets} indices</span> — best signal every{" "}
              <span className="text-signal-buy font-bold">5 min</span>.
            </p>
          </div>

          {/* Latest Signal Card */}
          {stats.latestSignal && (
            <SignalCard
              signal={stats.latestSignal}
              isBuy={isBuy}
              signalAge={signalAge}
              isTradeActive={!!isTradeActive}
              isTradeSettled={!!isTradeSettled}
              tradeResult={tradeResult}
              countdown={countdown}
              quickTradeAccount={quickTradeAccount}
              onAccountChange={setQuickTradeAccount}
              onQuickTrade={onQuickTrade ? handleQuickTrade : undefined}
              quickTradeLoading={!!quickTradeLoading}
            />
          )}
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          <StatCard icon={<Activity size={13} />} label="Markets" value={`${stats.activeMarkets}/${stats.totalMarkets}`} sub="Live streaming" accent="buy" />
          <StatCard icon={<TrendingUp size={13} />} label="Bull / Bear" value={`${stats.upCount} / ${stats.downCount}`} sub={`${stats.bullBear}% bullish`} accent={Number(stats.bullBear) >= 50 ? "buy" : "sell"} />
          <StatCard icon={<BarChart3 size={13} />} label="Signals" value={`${stats.buySignals}B / ${stats.sellSignals}S`} sub={`Avg score: ${stats.avgScore}`} accent="neutral" />
          <StatCard icon={<Target size={13} />} label="Duration" value={`${TRADE_DURATION_LIVE}m`} sub="Live trades" accent="buy" />
          <StatCard icon={<Zap size={13} />} label="Engine" value="v4.0" sub={`${stats.totalMarkets} symbols`} accent="buy" />
        </div>
      </div>
    </section>
  );
}

// ─── Signal Card Component ───────────────────────────────────

function SignalCard({
  signal, isBuy, signalAge, isTradeActive, isTradeSettled, tradeResult,
  countdown, quickTradeAccount, onAccountChange, onQuickTrade, quickTradeLoading,
}: {
  signal: Signal;
  isBuy: boolean;
  signalAge: string;
  isTradeActive: boolean;
  isTradeSettled: boolean;
  tradeResult?: { result: "WIN" | "LOSS" | "PENDING"; profit: number } | null;
  countdown: string;
  quickTradeAccount: "demo" | "live";
  onAccountChange: (v: "demo" | "live") => void;
  onQuickTrade?: () => void;
  quickTradeLoading: boolean;
}) {
  const accentColor = isBuy ? "signal-buy" : "signal-sell";

  return (
    <div className={`shrink-0 relative overflow-hidden rounded-xl border backdrop-blur-sm w-full lg:w-[320px] ${
      isTradeSettled
        ? tradeResult?.result === "WIN"
          ? "border-[hsl(var(--signal-buy)/0.35)] bg-gradient-to-br from-[hsl(var(--signal-buy)/0.06)] to-[hsl(var(--signal-buy)/0.02)]"
          : "border-[hsl(var(--signal-sell)/0.35)] bg-gradient-to-br from-[hsl(var(--signal-sell)/0.06)] to-[hsl(var(--signal-sell)/0.02)]"
        : isBuy
        ? "border-[hsl(var(--signal-buy)/0.25)] bg-gradient-to-br from-[hsl(var(--signal-buy)/0.08)] to-[hsl(var(--signal-buy)/0.02)]"
        : "border-[hsl(var(--signal-sell)/0.25)] bg-gradient-to-br from-[hsl(var(--signal-sell)/0.08)] to-[hsl(var(--signal-sell)/0.02)]"
    }`}>
      {/* Top accent line */}
      <div className={`absolute top-0 left-0 right-0 h-[2px] ${
        isTradeActive ? "bg-engine-text-muted animate-pulse" : isTradeSettled
          ? tradeResult?.result === "WIN" ? "bg-signal-buy" : "bg-signal-sell"
          : isBuy ? "bg-signal-buy" : "bg-signal-sell"
      }`} />

      <div className="px-5 py-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
              isTradeActive
                ? "bg-[hsl(var(--engine-surface))]"
                : isBuy ? "bg-[hsl(var(--signal-buy)/0.15)]" : "bg-[hsl(var(--signal-sell)/0.15)]"
            }`}>
              {isTradeActive ? (
                <Loader2 size={14} className="text-engine-text-muted animate-spin" />
              ) : isTradeSettled ? (
                <Check size={14} className={tradeResult?.result === "WIN" ? "text-signal-buy" : "text-signal-sell"} />
              ) : (
                <Zap size={14} className={isBuy ? "text-signal-buy" : "text-signal-sell"} />
              )}
            </div>
            <span className="text-[8px] uppercase tracking-[0.15em] text-engine-text-dim font-mono font-bold">
              {isTradeActive ? "Trade Active" : isTradeSettled ? "Settled" : "Latest Signal"}
            </span>
          </div>
          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full ${
            isTradeActive
              ? "bg-[hsl(var(--engine-surface))] text-engine-text-muted"
              : isBuy ? "bg-[hsl(var(--signal-buy)/0.12)] text-signal-buy" : "bg-[hsl(var(--signal-sell)/0.12)] text-signal-sell"
          }`}>
            <Clock size={10} className={isTradeActive ? "animate-spin" : ""} />
            <span className="text-[9px] font-mono font-bold">
              {isTradeActive && countdown ? countdown : signalAge}
            </span>
          </div>
        </div>

        {/* Signal direction + symbol */}
        <div className="flex items-baseline gap-3 mb-2">
          <span className={`text-xl font-black tracking-tight ${isBuy ? "text-signal-buy" : "text-signal-sell"}`}>
            {signal.type}
          </span>
          <span className="text-xs text-engine-text-secondary font-mono font-semibold">
            {SYMBOLS[signal.symbol]?.replace(" Index", "") || signal.symbol}
          </span>
        </div>

        {/* Metrics row */}
        <div className="flex items-center gap-4 text-[9px] font-mono text-engine-text-muted mb-3">
          <span className="flex items-center gap-1">
            <span className="text-engine-text-dim">Score</span>
            <b className={isBuy ? "text-signal-buy" : "text-signal-sell"}>{signal.score || "—"}</b>
          </span>
          <span className="flex items-center gap-1">
            <span className="text-engine-text-dim">Entry</span>
            <b className="text-engine-text-primary">${signal.price.toFixed(2)}</b>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-engine-text-dim">Conf</span>
            <div className="flex gap-[2px]">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className={`w-[5px] h-2.5 rounded-[1px] transition-colors ${
                    i < Math.round(((signal.score || 0) / 100) * 5)
                      ? isBuy ? "bg-signal-buy" : "bg-signal-sell"
                      : "bg-[hsl(0_0%_100%/0.08)]"
                  }`}
                />
              ))}
            </div>
          </span>
        </div>

        {/* Settlement result */}
        {isTradeSettled && tradeResult && (
          <div className={`flex items-center gap-2 mb-3 px-3 py-1.5 rounded-md text-[10px] font-mono font-bold ${
            tradeResult.result === "WIN"
              ? "bg-[hsl(var(--signal-buy)/0.1)] text-signal-buy"
              : "bg-[hsl(var(--signal-sell)/0.1)] text-signal-sell"
          }`}>
            {tradeResult.result === "WIN" ? "✅" : "❌"} {tradeResult.result} · P&L: ${tradeResult.profit.toFixed(2)}
          </div>
        )}

        {/* Quick Trade Button */}
        {onQuickTrade && (
          <div className="flex items-center gap-2">
            <select
              value={quickTradeAccount}
              onChange={(e) => onAccountChange(e.target.value as "demo" | "live")}
              className="engine-input text-[9px] py-1 px-2 w-16"
              disabled={isTradeActive}
            >
              <option value="demo">Demo</option>
              <option value="live">Live</option>
            </select>
            <button
              onClick={onQuickTrade}
              disabled={quickTradeLoading || isTradeActive}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-[9px] font-bold uppercase tracking-widest transition-all ${
                quickTradeLoading || isTradeActive
                  ? "bg-engine-surface text-engine-text-dim cursor-not-allowed"
                  : isBuy
                  ? "bg-signal-buy text-engine-bg hover:opacity-90 active:scale-[0.97] shadow-md shadow-signal-buy/20"
                  : "bg-signal-sell text-engine-bg hover:opacity-90 active:scale-[0.97] shadow-md shadow-signal-sell/20"
              }`}
            >
              {isTradeActive ? (
                <>
                  <Loader2 size={10} className="animate-spin" />
                  {countdown || "Pending..."}
                </>
              ) : (
                <>
                  <Play size={10} />
                  {quickTradeLoading ? "Placing..." : `Quick ${signal.type}`}
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Stat Card ───────────────────────────────────────────────

function StatCard({ icon, label, value, sub, accent }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  accent: "buy" | "sell" | "neutral";
}) {
  const colorClass = accent === "buy"
    ? "text-signal-buy"
    : accent === "sell"
    ? "text-signal-sell"
    : "text-engine-text-primary";

  const borderHover = accent === "buy"
    ? "hover:border-[hsl(var(--signal-buy)/0.15)]"
    : accent === "sell"
    ? "hover:border-[hsl(var(--signal-sell)/0.15)]"
    : "hover:border-[hsl(var(--engine-border-hover))]";

  return (
    <div className={`px-3.5 py-3 rounded-lg border border-engine-border bg-[hsl(var(--engine-surface))] ${borderHover} transition-all group cursor-default`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-engine-text-dim group-hover:text-engine-text-muted transition-colors">{icon}</span>
        <span className="text-[7px] uppercase tracking-[0.15em] text-engine-text-dim font-mono font-bold">{label}</span>
      </div>
      <p className={`text-sm font-black font-mono ${colorClass} leading-none`}>{value}</p>
      <p className="text-[7.5px] text-engine-text-dim font-mono mt-1 truncate">{sub}</p>
    </div>
  );
}
