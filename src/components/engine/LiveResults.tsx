import { Zap } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { LiveAutomationStatus } from "@/types/engine";

interface LiveResultsProps {
  status: LiveAutomationStatus | null;
}

export function LiveResults({ status }: LiveResultsProps) {
  if (!status) return null;

  return (
    <AnimatePresence>
      <motion.section
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        className="overflow-hidden"
      >
        <div className="space-y-6">
          <div className="p-6 engine-panel rounded-lg">
            <h3 className="engine-section-title mb-4">
              <Zap size={14} /> Live Automation Status
            </h3>
            <div className="text-[10px] space-y-2 font-mono text-engine-text-secondary">
              <p>Account: <strong>{status.accountType}</strong></p>
              <p>Running: <strong className={status.running ? "text-signal-buy" : "text-engine-text-muted"}>{status.running ? "Yes" : "No"}</strong></p>
              {status.initialBalance != null && (
                <p>Initial Balance: <strong>${status.initialBalance.toFixed(2)}</strong></p>
              )}
              {status.currentBalance != null && (
                <p>Current Balance: <strong>${status.currentBalance.toFixed(2)}</strong></p>
              )}
              {status.profitTargetReached && (
                <p className="text-signal-buy font-bold">✓ Profit target reached</p>
              )}
              {status.martingaleStopped && (
                <p className="text-signal-sell font-bold">✗ Max martingale loss – stopped</p>
              )}
              {status.error && (
                <p className="text-signal-sell font-bold">Error: {status.error}</p>
              )}
            </div>
          </div>

          {status.trades && status.trades.length > 0 && (
            <div className="p-6 engine-panel rounded-lg">
              <h4 className="text-sm font-bold text-engine-text-secondary uppercase tracking-widest mb-4">
                Recent Trades
              </h4>
              <div className="overflow-x-auto rounded-md border border-engine-border bg-engine-bg max-h-64 overflow-y-auto">
                <table className="w-full text-left text-[9px] font-mono">
                  <thead className="sticky top-0 bg-engine-bg/90 backdrop-blur-sm">
                    <tr className="text-engine-text-dim border-b border-engine-border uppercase tracking-tighter">
                      <th className="px-3 py-2 font-medium">Time</th>
                      <th className="px-3 py-2 font-medium">Symbol</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Amount</th>
                      <th className="px-3 py-2 font-medium">Result</th>
                      <th className="px-3 py-2 font-medium">Profit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-engine-border">
                    {[...status.trades].reverse().map((t, i) => (
                      <tr key={i} className="hover:bg-engine-surface transition-colors">
                        <td className="px-3 py-2 text-engine-text-muted">
                          {new Date(t.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="px-3 py-2 text-engine-text-secondary font-bold">
                          {t.signal?.symbol ?? "-"}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`flex items-center gap-1 ${
                              t.signal?.type === "BUY" ? "text-signal-buy" : "text-signal-sell"
                            }`}
                          >
                            <div
                              className={`w-2 h-2 rounded-full ${
                                t.signal?.type === "BUY" ? "bg-signal-buy" : "bg-signal-sell"
                              }`}
                            />
                            {t.signal?.type ?? "-"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-engine-text-secondary">${t.tradeAmount.toFixed(2)}</td>
                        <td className="px-3 py-2 font-bold text-engine-text-primary">{t.result || "-"}</td>
                        <td className="px-3 py-2 text-engine-text-secondary">
                          {t.profit != null ? `$${t.profit.toFixed(2)}` : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </motion.section>
    </AnimatePresence>
  );
}
