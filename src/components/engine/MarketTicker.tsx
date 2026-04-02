import { TrendingUp, TrendingDown, Minus, Activity } from "lucide-react";
import type { MarketStatus } from "@/types/engine";
import { SYMBOLS } from "@/types/engine";

const TIMEFRAMES = [1, 3, 5, 10, 15] as const;
const EMA_PERIODS = [9, 21, 50, 100] as const;

interface MarketTickerProps {
  status: MarketStatus[];
  timeframe?: number;
  onTimeframeChange?: (tf: number) => void;
  emaPeriod?: number;
  onEmaPeriodChange?: (period: number) => void;
  trendDirections?: Map<string, "up" | "down" | "neutral">;
}

export function MarketTicker({
  status,
  timeframe = 15,
  onTimeframeChange,
  emaPeriod = 50,
  onEmaPeriodChange,
  trendDirections,
}: MarketTickerProps) {
  if (status.length === 0) return null;

  return (
    <div className="bg-[hsl(var(--engine-bg)/0.6)] border-b border-[hsl(var(--engine-border))] px-4 py-3">
      <div className="max-w-[1600px] mx-auto">
        {/* Controls Toolbar */}
        <div className="flex flex-wrap items-center gap-4 mb-3">
          {/* Timeframe Selector */}
          {onTimeframeChange && (
            <div className="flex items-center gap-2">
              <span className="text-[8px] text-[hsl(var(--engine-text-dim))] font-mono font-bold uppercase tracking-widest whitespace-nowrap">
                <Activity size={10} className="inline mr-1 opacity-60" />
                Trend TF
              </span>
              <div className="flex gap-0.5 bg-[hsl(var(--engine-surface))] rounded-md p-0.5 border border-[hsl(var(--engine-border))]">
                {TIMEFRAMES.map((tf) => (
                  <button
                    key={tf}
                    onClick={() => onTimeframeChange(tf)}
                    className={`px-2.5 py-1 rounded text-[8px] font-mono font-bold transition-all ${
                      timeframe === tf
                        ? "bg-[hsl(var(--signal-buy))] text-[hsl(var(--engine-bg))] shadow-sm"
                        : "text-[hsl(var(--engine-text-muted))] hover:text-[hsl(var(--engine-text-primary))] hover:bg-[hsl(var(--engine-surface-hover))]"
                    }`}
                  >
                    {tf}m
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Separator */}
          <div className="hidden sm:block w-px h-5 bg-[hsl(var(--engine-border))]" />

          {/* EMA Period Selector */}
          {onEmaPeriodChange && (
            <div className="flex items-center gap-2">
              <span className="text-[8px] text-[hsl(var(--engine-text-dim))] font-mono font-bold uppercase tracking-widest whitespace-nowrap">
                EMA
              </span>
              <div className="flex gap-0.5 bg-[hsl(var(--engine-surface))] rounded-md p-0.5 border border-[hsl(var(--engine-border))]">
                {EMA_PERIODS.map((p) => (
                  <button
                    key={p}
                    onClick={() => onEmaPeriodChange(p)}
                    className={`px-2.5 py-1 rounded text-[8px] font-mono font-bold transition-all ${
                      emaPeriod === p
                        ? "bg-[hsl(var(--status-info))] text-white shadow-sm"
                        : "text-[hsl(var(--engine-text-muted))] hover:text-[hsl(var(--engine-text-primary))] hover:bg-[hsl(var(--engine-surface-hover))]"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Separator */}
          <div className="hidden sm:block w-px h-5 bg-[hsl(var(--engine-border))]" />

          {/* Market Count Badge */}
          <div className="ml-auto flex items-center gap-1.5">
            <div className="status-dot-healthy" />
            <span className="text-[8px] text-[hsl(var(--engine-text-dim))] font-mono font-bold uppercase tracking-widest">
              {status.length} Markets · TF:{timeframe}m · EMA:{emaPeriod}
            </span>
          </div>
        </div>

        {/* Market Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-2">
          {status.map((item) => {
            const tfDir = trendDirections?.get(item.symbol);
            const dir = tfDir || item.direction || "neutral";
            const isUp = dir === "up";
            const isDown = dir === "down";

            return (
              <div
                key={item.symbol}
                className={`
                  flex items-center justify-between gap-2 px-3 py-2 rounded-md border transition-all duration-300
                  ${isUp
                    ? "border-[hsl(var(--signal-buy)/0.3)] bg-[hsl(var(--signal-buy)/0.05)]"
                    : isDown
                    ? "border-[hsl(var(--signal-sell)/0.3)] bg-[hsl(var(--signal-sell)/0.05)]"
                    : "border-[hsl(var(--engine-border))] bg-[hsl(var(--engine-surface))]"
                  }
                `}
              >
                <div className="flex flex-col min-w-0">
                  <span className="text-[8px] font-bold uppercase tracking-tight truncate text-[hsl(var(--engine-text-muted))]">
                    {SYMBOLS[item.symbol]?.replace(" Index", "").replace(" (1s)", " 1s") || item.symbol}
                  </span>
                  <span
                    className={`text-xs font-mono font-black tracking-tight transition-colors duration-200 ${
                      isUp
                        ? "text-[hsl(var(--signal-buy))]"
                        : isDown
                        ? "text-[hsl(var(--signal-sell))]"
                        : "text-[hsl(var(--engine-text-primary))]"
                    }`}
                  >
                    {item.lastPrice.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
                <div className="flex-shrink-0">
                  {isUp ? (
                    <TrendingUp size={12} className="text-[hsl(var(--signal-buy))]" />
                  ) : isDown ? (
                    <TrendingDown size={12} className="text-[hsl(var(--signal-sell))]" />
                  ) : (
                    <Minus size={12} className="text-[hsl(var(--engine-text-dim))]" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
