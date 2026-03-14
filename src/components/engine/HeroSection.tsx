import { useEffect, useState, useMemo } from "react";
import { Activity, BarChart3, TrendingUp, Zap, Target, Shield, Clock } from "lucide-react";
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

  const signalAge = useMemo(() => {
    if (!stats.latestSignal?.time) return "";
    const diff = Date.now() - new Date(stats.latestSignal.time).getTime();
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return `${Math.floor(diff / 3600000)}h ago`;
  }, [stats.latestSignal, tick]);

  const isBuy = stats.latestSignal?.type === "BUY";

  return (
    <section className="relative overflow-hidden border-b border-engine-border">
      {/* Layered gradient backdrop */}
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
              Monitoring <span className="text-engine-text-secondary font-bold">{stats.totalMarkets}</span> indices ·
              EMA · RSI · MACD · ATR · Divergence · Engulfing ·
              Best signal every <span className="text-signal-buy font-bold">5 min</span>
            </p>
          </div>

          {/* Latest Signal Card — polished */}
          {stats.latestSignal && (
            <div className={`shrink-0 relative overflow-hidden rounded-xl border backdrop-blur-sm ${
              isBuy
                ? "border-[hsl(var(--signal-buy)/0.25)] bg-gradient-to-br from-[hsl(var(--signal-buy)/0.08)] to-[hsl(var(--signal-buy)/0.02)]"
                : "border-[hsl(var(--signal-sell)/0.25)] bg-gradient-to-br from-[hsl(var(--signal-sell)/0.08)] to-[hsl(var(--signal-sell)/0.02)]"
            }`}>
              {/* Glow accent */}
              <div className={`absolute top-0 left-0 right-0 h-[2px] ${isBuy ? "bg-signal-buy" : "bg-signal-sell"}`} />
              
              <div className="px-5 py-4">
                <div className="flex items-center justify-between gap-4 mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                      isBuy ? "bg-[hsl(var(--signal-buy)/0.15)]" : "bg-[hsl(var(--signal-sell)/0.15)]"
                    }`}>
                      <Zap size={14} className={isBuy ? "text-signal-buy" : "text-signal-sell"} />
                    </div>
                    <span className="text-[8px] uppercase tracking-[0.15em] text-engine-text-dim font-mono font-bold">
                      Latest Signal
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-engine-text-dim">
                    <Clock size={9} />
                    <span className="text-[8px] font-mono">{signalAge}</span>
                  </div>
                </div>

                <div className="flex items-baseline gap-3 mb-2">
                  <span className={`text-xl font-black tracking-tight ${isBuy ? "text-signal-buy" : "text-signal-sell"}`}>
                    {stats.latestSignal.type}
                  </span>
                  <span className="text-xs text-engine-text-secondary font-mono font-semibold">
                    {SYMBOLS[stats.latestSignal.symbol]?.replace(" Index", "") || stats.latestSignal.symbol}
                  </span>
                </div>

                <div className="flex items-center gap-4 text-[9px] font-mono text-engine-text-muted">
                  <span className="flex items-center gap-1">
                    <span className="text-engine-text-dim">Score</span>
                    <b className={isBuy ? "text-signal-buy" : "text-signal-sell"}>{stats.latestSignal.score || "—"}</b>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="text-engine-text-dim">Entry</span>
                    <b className="text-engine-text-primary">${stats.latestSignal.price.toFixed(2)}</b>
                  </span>
                  {/* Confidence bar */}
                  <span className="flex items-center gap-1.5">
                    <span className="text-engine-text-dim">Conf</span>
                    <div className="flex gap-[2px]">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <div
                          key={i}
                          className={`w-[5px] h-2.5 rounded-[1px] transition-colors ${
                            i < Math.round(((stats.latestSignal?.score || 0) / 100) * 5)
                              ? isBuy ? "bg-signal-buy" : "bg-signal-sell"
                              : "bg-[hsl(0_0%_100%/0.08)]"
                          }`}
                        />
                      ))}
                    </div>
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <StatCard
            icon={<Activity size={13} />}
            label="Markets"
            value={`${stats.activeMarkets}/${stats.totalMarkets}`}
            sub="Live streaming"
            accent="buy"
          />
          <StatCard
            icon={<TrendingUp size={13} />}
            label="Bull / Bear"
            value={`${stats.upCount} / ${stats.downCount}`}
            sub={`${stats.bullBear}% bullish`}
            accent={Number(stats.bullBear) >= 50 ? "buy" : "sell"}
          />
          <StatCard
            icon={<BarChart3 size={13} />}
            label="Signals"
            value={`${stats.buySignals}B / ${stats.sellSignals}S`}
            sub={`Avg: ${stats.avgScore}`}
            accent="neutral"
          />
          <StatCard
            icon={<Target size={13} />}
            label="Interval"
            value="5 min"
            sub="Strict cycle"
            accent="buy"
          />
          <StatCard
            icon={<Shield size={13} />}
            label="Indicators"
            value="6"
            sub="EMA RSI MACD ATR"
            accent="neutral"
          />
          <StatCard
            icon={<Zap size={13} />}
            label="Engine"
            value="v3.0"
            sub="Multi-symbol"
            accent="buy"
          />
        </div>
      </div>
    </section>
  );
}

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
