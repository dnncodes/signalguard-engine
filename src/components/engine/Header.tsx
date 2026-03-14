import { Zap, Bell, Settings, RefreshCw } from "lucide-react";
import type { MarketStatus } from "@/types/engine";

interface HeaderProps {
  marketCount: number;
}

export function Header({ marketCount }: HeaderProps) {
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
                v2.1 PRO
              </span>
              <div className="hidden sm:flex items-center gap-1.5 text-[8px] text-engine-text-dim font-mono">
                <div className="status-dot-healthy" />
                LIVE FEED
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          <div className="hidden md:flex items-center gap-6 text-[10px] font-mono text-engine-text-muted mr-4">
            <div className="flex flex-col items-end">
              <span className="text-[8px] text-engine-text-dim uppercase tracking-widest">Connection</span>
              <span className="text-signal-buy font-bold">WS STABLE</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[8px] text-engine-text-dim uppercase tracking-widest">Markets</span>
              <span className="text-engine-text-secondary font-bold">{marketCount} ACTIVE</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button className="p-2 hover:bg-engine-surface-hover rounded-md transition-all group">
              <Bell size={16} className="text-engine-text-muted group-hover:text-signal-buy" />
            </button>
            <button className="p-2 hover:bg-engine-surface-hover rounded-md transition-all group">
              <Settings size={16} className="text-engine-text-muted group-hover:text-signal-buy" />
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Status Bar */}
      <div className="md:hidden flex items-center justify-between px-4 py-1.5 bg-signal-buy-bg border-t border-engine-border text-[8px] font-mono">
        <div className="flex items-center gap-1.5 text-signal-buy">
          <div className="status-dot-healthy" />
          <span>WS CONNECTED</span>
        </div>
        <div className="flex items-center gap-1.5 text-engine-text-dim">
          <RefreshCw size={8} className="animate-spin-slow" />
          <span>SYNCING {marketCount} MARKETS</span>
        </div>
      </div>
    </header>
  );
}
