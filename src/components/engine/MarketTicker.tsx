import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { MarketStatus } from "@/types/engine";
import { SYMBOLS } from "@/types/engine";

interface MarketTickerProps {
  status: MarketStatus[];
}

export function MarketTicker({ status }: MarketTickerProps) {
  if (status.length === 0) return null;

  return (
    <div className="bg-[hsl(var(--engine-bg)/0.6)] border-b border-[hsl(var(--engine-border))] px-4 py-3">
      <div className="max-w-[1600px] mx-auto">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-2">
          {status.map((item) => {
            const dir = item.direction || "neutral";
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
