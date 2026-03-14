import { useEffect, useState, useMemo } from "react";
import { Activity, BarChart3, TrendingUp, Zap, Target, Shield } from "lucide-react";
import type { MarketStatus, Signal } from "@/types/engine";
import { SYMBOLS } from "@/types/engine";

interface HeroSectionProps {
  status: MarketStatus[];
  signals: Signal[];
  wsStatus: string;
}

export function HeroSection({ status, signals, wsStatus }: HeroSectionProps) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((p) => p + 1), 3000);
    return () => clearInterval(t);
  }, []);

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

  return (
    <section className="relative overflow-hidden border-b border-engine-border">
      {/* Animated gradient backdrop */}
      <div className="absolute inset-0 bg-gradient-to-br from-[hsl(var(--signal-buy)/0.03)] via-[hsl(var(--engine-bg))] to-[hsl(var(--signal-sell)/0.03)]" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-[hsl(var(--signal-buy)/0.04)] rounded-full blur-[120px] pointer-events-none" />

      <div className="relative max-w-[1600px] mx-auto px-6 py-8">
        {/* Top line — tagline */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-[hsl(var(--signal-buy)/0.2)] bg-[hsl(var(--signal-buy)/0.05)]">
            <div className="w-1.5 h-1.5 rounded-full bg-signal-buy animate-pulse" />
            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-signal-buy font-mono">
              {wsStatus === "connected" ? "LIVE" : "OFFLINE"} · {stats.activeMarkets} MARKETS STREAMING
            </span>
          </div>
          <span className="hidden sm:inline text-[9px] text-engine-text-dim font-mono tracking-widest">
            5-MIN SCALPING · MULTI-SYMBOL ANALYSIS · REAL-TIME SIGNALS
          </span>
        </div>

        {/* Main headline */}
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 mb-8">
          <div>
            <h2 className="text-2xl md:text-3xl font-black tracking-tight text-engine-text-primary leading-tight">
              Synthetic Index
              <span className="text-signal-buy"> Command Center</span>
            </h2>
            <p className="text-xs text-engine-text-muted mt-2 max-w-xl leading-relaxed">
              Monitoring <span className="text-engine-text-secondary font-bold">{stats.totalMarkets}</span> synthetic indices with
              EMA crossovers, RSI, MACD, ATR volatility, engulfing patterns and price-RSI divergence detection.
              Signals generated every <span className="text-signal-buy font-bold">5 minutes</span> picking the highest-confidence opportunity.
            </p>
          </div>

          {/* Latest signal card */}
          {stats.latestSignal && (
            <div className={`shrink-0 px-5 py-4 rounded-lg border ${
              stats.latestSignal.type === "BUY"
                ? "border-[hsl(var(--signal-buy)/0.3)] bg-[hsl(var(--signal-buy)/0.05)]"
                : "border-[hsl(var(--signal-sell)/0.3)] bg-[hsl(var(--signal-sell)/0.05)]"
            }`}>
              <div className="flex items-center gap-2 mb-1">
                <Zap size={12} className={stats.latestSignal.type === "BUY" ? "text-signal-buy" : "text-signal-sell"} />
                <span className="text-[8px] uppercase tracking-widest text-engine-text-dim font-mono">Latest Signal</span>
              </div>
              <div className="flex items-baseline gap-3">
                <span className={`text-lg font-black ${stats.latestSignal.type === "BUY" ? "text-signal-buy" : "text-signal-sell"}`}>
                  {stats.latestSignal.type}
                </span>
                <span className="text-xs text-engine-text-secondary font-mono">
                  {SYMBOLS[stats.latestSignal.symbol]?.replace(" Index", "") || stats.latestSignal.symbol}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-[9px] font-mono text-engine-text-muted">
                <span>Score: <b className="text-engine-text-primary">{stats.latestSignal.score || "—"}</b></span>
                <span>${stats.latestSignal.price.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard
            icon={<Activity size={14} />}
            label="Active Markets"
            value={`${stats.activeMarkets}/${stats.totalMarkets}`}
            sub="Streaming live ticks"
            color="text-signal-buy"
          />
          <StatCard
            icon={<TrendingUp size={14} />}
            label="Bull / Bear"
            value={`${stats.upCount} / ${stats.downCount}`}
            sub={`${stats.bullBear}% bullish sentiment`}
            color={Number(stats.bullBear) >= 50 ? "text-signal-buy" : "text-signal-sell"}
          />
          <StatCard
            icon={<BarChart3 size={14} />}
            label="Signals (10)"
            value={`${stats.buySignals}B / ${stats.sellSignals}S`}
            sub={`Avg score: ${stats.avgScore}`}
            color="text-engine-text-primary"
          />
          <StatCard
            icon={<Target size={14} />}
            label="Signal Interval"
            value="5 min"
            sub="Strict cycle timing"
            color="text-signal-buy"
          />
          <StatCard
            icon={<Shield size={14} />}
            label="Indicators"
            value="6"
            sub="EMA RSI MACD ATR DIV ENG"
            color="text-engine-text-primary"
          />
          <StatCard
            icon={<Zap size={14} />}
            label="Engine"
            value="v3.0"
            sub="Multi-symbol concurrent"
            color="text-signal-buy"
          />
        </div>
      </div>
    </section>
  );
}

function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div className="px-4 py-3.5 rounded-lg border border-engine-border bg-[hsl(var(--engine-surface))] hover:border-[hsl(var(--engine-border-hover))] transition-all group">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-engine-text-dim group-hover:text-engine-text-muted transition-colors">{icon}</span>
        <span className="text-[8px] uppercase tracking-[0.15em] text-engine-text-dim font-mono font-bold">{label}</span>
      </div>
      <p className={`text-base font-black font-mono ${color} leading-none`}>{value}</p>
      <p className="text-[8px] text-engine-text-dim font-mono mt-1.5 truncate">{sub}</p>
    </div>
  );
}
