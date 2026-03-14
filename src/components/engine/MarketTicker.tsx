import type { MarketStatus } from "@/types/engine";
import { SYMBOLS } from "@/types/engine";

interface MarketTickerProps {
  status: MarketStatus[];
}

export function MarketTicker({ status }: MarketTickerProps) {
  if (status.length === 0) return null;

  const renderItem = (item: MarketStatus, keySuffix = "") => (
    <div
      key={`${item.symbol}${keySuffix}`}
      className="inline-flex items-center gap-3 px-4 py-1.5 engine-panel engine-panel-hover cursor-default group"
    >
      <span className="text-[9px] font-black text-engine-text-dim group-hover:text-signal-buy transition-colors uppercase tracking-tighter">
        {SYMBOLS[item.symbol] || item.symbol}
      </span>
      <span className="text-xs font-mono font-bold tracking-tight text-engine-text-primary">
        {item.lastPrice.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </span>
      <div className="flex items-center gap-1">
        <div className="status-dot-healthy" />
        <span className="text-[8px] text-signal-buy/60 font-bold">{item.candles}</span>
      </div>
    </div>
  );

  return (
    <div className="bg-engine-bg/40 border-b border-engine-border overflow-hidden whitespace-nowrap py-2.5 relative">
      <div className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-engine-bg to-transparent z-10" />
      <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-engine-bg to-transparent z-10" />
      <div className="flex animate-marquee gap-6 px-6">
        {status.map((item) => renderItem(item))}
        {status.map((item) => renderItem(item, "-dup"))}
      </div>
    </div>
  );
}
