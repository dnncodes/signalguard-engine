import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { MarketStatus } from "@/types/engine";
import { SYMBOLS } from "@/types/engine";

const TIMEFRAMES = [1, 3, 5, 10, 15] as const;

interface MarketTickerProps {
  status: MarketStatus[];
  timeframe?: number;
  onTimeframeChange?: (tf: number) => void;
  trendDirections?: Map<string, "up" | "down" | "neutral">;
}

export function MarketTicker({ status, timeframe = 15, onTimeframeChange, trendDirections }: MarketTickerProps) {
  if (status.length === 0) return null;

  return (
    <div className="bg-[hsl(var(--engine-bg)/0.6)] border-b border-[hsl(var(--engine-border))] px-4 py-3">
      <div className="max-w-[1600px] mx-auto">
        {/* Timeframe Selector */}
        {onTimeframeChange && (
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[8px] text-[hsl(var(--engine-text-dim))] font-mono font-bold uppercase tracking-widest">
              Trend TF:
            </span>
            <div className="flex gap-1">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  onClick={() => onTimeframeChange(tf)}
                  className={`px-2 py-0.5 rounded text-[8px] font-mono font-bold transition-all ${
                    timeframe === tf
                      ? "bg-[hsl(var(--signal-buy))] text-[hsl(var(--engine-bg))]"
                      : "bg-[hsl(var(--engine-surface))] text-[hsl(var(--engine-text-muted))] hover:bg-[hsl(var(--engine-surface-hover))] border border-[hsl(var(--engine-border))]"
                  }`}
                >
                  {tf}m
                </button>
              ))}
            </div>
            <span className="text-[7px] text-[hsl(var(--engine-text-dim))] font-mono ml-1">
              (default {timeframe}min)
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-2">
          {status.map((item) => {
            // Use timeframe-based trend direction if available, otherwise per-tick direction
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
