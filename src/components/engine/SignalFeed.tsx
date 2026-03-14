import { TrendingUp, TrendingDown, Bell, Layers, Target } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { SYMBOLS, type Signal } from "@/types/engine";

interface SignalFeedProps {
  signals: Signal[];
}

export function SignalFeed({ signals }: SignalFeedProps) {
  return (
    <section>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-engine-surface rounded-md flex items-center justify-center">
            <Bell size={16} className="text-engine-text-muted" />
          </div>
          <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-engine-text-primary">
            Live Intelligence Stream
          </h2>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-engine-text-dim font-mono">
          <div className="status-dot-healthy" />
          REAL-TIME
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <AnimatePresence mode="popLayout">
          {signals.length === 0 ? (
            <div className="col-span-full h-64 flex flex-col items-center justify-center border border-dashed border-engine-border rounded-lg text-engine-text-dim">
              <Layers size={48} className="mb-4 opacity-10" />
              <p className="text-xs uppercase tracking-widest font-bold">Analyzing market structures...</p>
            </div>
          ) : (
            signals.map((signal) => (
              <motion.div
                key={signal.id}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="group relative overflow-hidden p-5 engine-panel engine-panel-hover rounded-lg"
              >
                {/* Accent bar */}
                <div
                  className={`absolute top-0 left-0 bottom-0 w-1 ${
                    signal.type === "BUY" ? "bg-signal-buy" : "bg-signal-sell"
                  }`}
                />

                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-md flex items-center justify-center ${
                        signal.type === "BUY"
                          ? "bg-signal-buy-bg text-signal-buy"
                          : "bg-signal-sell-bg text-signal-sell"
                      }`}
                    >
                      {signal.type === "BUY" ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
                    </div>
                    <div>
                      <h3 className="text-sm font-bold tracking-tight text-engine-text-primary">
                        {SYMBOLS[signal.symbol] || signal.symbol}
                      </h3>
                      <p className="text-[10px] font-mono text-engine-text-dim">
                        {new Date(signal.time).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                  <div
                    className={`px-2.5 py-1 rounded-sm text-[10px] font-black tracking-tighter ${
                      signal.type === "BUY"
                        ? "bg-signal-buy text-engine-bg"
                        : "bg-signal-sell text-engine-text-primary"
                    }`}
                  >
                    {signal.type}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="p-3 bg-engine-bg rounded-md border border-engine-border">
                    <p className="text-[9px] text-engine-text-dim uppercase font-bold mb-1">Entry Price</p>
                    <p className="text-lg font-mono font-bold text-engine-text-primary">
                      {signal.price.toFixed(2)}
                    </p>
                  </div>
                  <div className="p-3 bg-engine-bg rounded-md border border-engine-border">
                    <p className="text-[9px] text-engine-text-dim uppercase font-bold mb-1">Confidence</p>
                    <div className="flex items-center gap-2">
                      <p className="text-lg font-mono font-bold text-signal-buy">
                        {signal.score || 85}%
                      </p>
                      <div className="flex-1 h-1 bg-engine-border rounded-full overflow-hidden">
                        <div
                          className="h-full bg-signal-buy transition-all"
                          style={{ width: `${signal.score || 85}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-[11px] text-engine-text-secondary">
                  <Target size={12} className="text-signal-buy" />
                  <span className="font-medium">{signal.details}</span>
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
