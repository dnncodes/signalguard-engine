import { TrendingUp, TrendingDown, History } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { BacktestResult } from "@/types/engine";

interface BacktestResultsProps {
  results: BacktestResult | null;
  onClear: () => void;
}

export function BacktestResults({ results, onClear }: BacktestResultsProps) {
  if (!results) return null;

  const { summary } = results;
  if (!summary) return null;

  const netProfit = parseFloat(summary.totalNetProfit);
  const initBal = parseFloat(summary.initialBalance);
  const returnPct = initBal > 0 ? ((netProfit / initBal) * 100).toFixed(2) : "0.00";

  return (
    <AnimatePresence>
      <motion.section
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        className="overflow-hidden"
      >
        <div className="space-y-6">
          {/* Hero P&L Card */}
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`relative overflow-hidden rounded-lg border-2 backdrop-blur-md p-8 ${
              summary.isProfitable
                ? "bg-gradient-to-br from-signal-buy-bg via-transparent to-transparent border-signal-buy/40 shadow-2xl shadow-signal-buy/20"
                : "bg-gradient-to-br from-signal-sell-bg via-transparent to-transparent border-signal-sell/40 shadow-2xl shadow-signal-sell/20"
            }`}
          >
            <div className="absolute inset-0 opacity-10">
              <div
                className={`absolute top-0 right-0 w-96 h-96 rounded-full blur-3xl ${
                  summary.isProfitable ? "bg-signal-buy" : "bg-signal-sell"
                } animate-pulse`}
              />
            </div>

            <div className="relative z-10">
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div
                    className={`w-16 h-16 rounded-lg flex items-center justify-center ${
                      summary.isProfitable ? "bg-signal-buy-bg" : "bg-signal-sell-bg"
                    }`}
                  >
                    {summary.isProfitable ? (
                      <TrendingUp size={32} className="text-signal-buy" />
                    ) : (
                      <TrendingDown size={32} className="text-signal-sell" />
                    )}
                  </div>
                  <div>
                    <h2 className="text-xs font-bold uppercase tracking-[0.3em] text-engine-text-muted mb-1">
                      Account Result
                    </h2>
                    <p className="text-sm text-engine-text-secondary">Backtest Complete</p>
                    {results.stopReason && (
                      <p className="text-[9px] text-warning italic mt-1 font-mono">
                        Stopped early:{" "}
                        {results.stopReason === "profitTarget" ? "profit target" : "martingale limit"}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  onClick={onClear}
                  className="px-4 py-2 bg-engine-surface hover:bg-engine-surface-hover border border-engine-border rounded-md text-[10px] font-bold text-engine-text-muted hover:text-engine-text-secondary transition-all uppercase tracking-widest"
                >
                  Clear
                </button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="md:col-span-2">
                  <div className="text-[11px] font-bold uppercase tracking-widest text-engine-text-muted mb-2">
                    Net Profit / Loss
                  </div>
                  <div
                    className={`text-5xl font-black tracking-tighter font-mono ${
                      summary.isProfitable ? "text-signal-buy" : "text-signal-sell"
                    }`}
                  >
                    {summary.isProfitable ? "+" : "-"}${Math.abs(netProfit).toFixed(2)}
                  </div>
                  <div
                    className={`text-[10px] font-mono mt-1 ${
                      summary.isProfitable ? "text-signal-buy/60" : "text-signal-sell/60"
                    }`}
                  >
                    {summary.isProfitable ? "✓ PROFITABLE" : "✗ LOSS"}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] font-bold uppercase tracking-widest text-engine-text-muted mb-2">
                    Final Balance
                  </div>
                  <div className="text-3xl font-black text-engine-text-primary font-mono">
                    ${parseFloat(summary.finalBalance).toFixed(2)}
                  </div>
                  <div className="text-[9px] text-engine-text-muted mt-1 font-mono">
                    From ${summary.initialBalance}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] font-bold uppercase tracking-widest text-engine-text-muted mb-2">
                    Return %
                  </div>
                  <div
                    className={`text-3xl font-black font-mono ${
                      summary.isProfitable ? "text-signal-buy" : "text-signal-sell"
                    }`}
                  >
                    {returnPct}%
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="border-t border-engine-border pt-6 grid grid-cols-2 md:grid-cols-5 gap-4">
                <StatItem label="Total Trades" value={String(summary.totalTrades)} />
                <StatItem label="Win Rate" value={summary.winRate} className="text-signal-buy" />
                <StatItem
                  label="Wins / Losses"
                  value={`${summary.totalWins} / ${summary.totalLosses}`}
                  custom={
                    <p className="text-xl font-bold font-mono">
                      <span className="text-signal-buy">{summary.totalWins}</span>
                      {" / "}
                      <span className="text-signal-sell">{summary.totalLosses}</span>
                    </p>
                  }
                />
                <StatItem label="Max Drawdown" value={summary.maxDrawdown} className="text-signal-sell" />
                <StatItem label="Profit Factor" value={summary.profitFactor} />
              </div>
            </div>
          </motion.div>

          {/* Config summary */}
          <div className="p-6 engine-panel rounded-lg">
            <h3 className="text-xs font-bold uppercase tracking-widest text-engine-text-secondary mb-4">
              Simulation Parameters
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-[10px] font-mono">
              <ConfigItem label="Duration" value={`${results.duration}h`} />
              <ConfigItem label="Timeframe" value={`${results.timeframe}min`} />
              <ConfigItem label="Trade Amount" value={`$${results.initialTradeAmount}`} />
              <ConfigItem label="Martingale" value={`${results.martingaleMultiplier}x`} />
              <ConfigItem label="Max Level" value={String(results.maxMartingaleLevel ?? "-")} />
            </div>
          </div>

          {/* Trade history */}
          {results.allTrades && results.allTrades.length > 0 && (
            <div className="p-6 engine-panel rounded-lg">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 bg-signal-buy-bg rounded-sm flex items-center justify-center">
                    <History size={14} className="text-signal-buy" />
                  </div>
                  <h3 className="text-sm font-bold text-engine-text-secondary uppercase tracking-widest">
                    Complete Trade History
                  </h3>
                </div>
                <div className="text-[9px] font-mono text-engine-text-muted">
                  {results.allTrades.length} Total Trades
                </div>
              </div>

              <div className="overflow-x-auto rounded-md border border-engine-border bg-engine-bg max-h-96 overflow-y-auto">
                <table className="w-full text-left text-[9px] font-mono">
                  <thead className="sticky top-0 bg-engine-bg/90 backdrop-blur-sm">
                    <tr className="text-engine-text-dim border-b border-engine-border uppercase tracking-tighter">
                      <th className="px-3 py-2 font-medium">Time</th>
                      <th className="px-3 py-2 font-medium">Symbol</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Amount</th>
                      <th className="px-3 py-2 font-medium">Entry</th>
                      <th className="px-3 py-2 font-medium">Exit</th>
                      <th className="px-3 py-2 font-medium">Result</th>
                      <th className="px-3 py-2 font-medium">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-engine-border">
                    {results.allTrades.map((trade, i) => (
                      <tr key={i} className="hover:bg-engine-surface transition-colors">
                        <td className="px-3 py-2 text-engine-text-muted">
                          {new Date(trade.executionTime).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </td>
                        <td className="px-3 py-2 text-engine-text-secondary font-bold">{trade.symbol}</td>
                        <td className="px-3 py-2">
                          <span className={`flex items-center gap-1 ${trade.type === "BUY" ? "text-signal-buy" : "text-signal-sell"}`}>
                            <div className={`w-2 h-2 rounded-full ${trade.type === "BUY" ? "bg-signal-buy" : "bg-signal-sell"}`} />
                            {trade.type}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-engine-text-secondary">${trade.tradeAmount.toFixed(2)}</td>
                        <td className="px-3 py-2 text-engine-text-secondary">{trade.entryPrice.toFixed(5)}</td>
                        <td className="px-3 py-2 text-engine-text-secondary">{trade.exitPrice.toFixed(5)}</td>
                        <td className="px-3 py-2 font-bold">
                          <span className={trade.result === "WIN" ? "text-signal-buy" : "text-signal-sell"}>
                            {trade.result}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-engine-text-primary">
                          ${trade.newBalance.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Per-symbol breakdown */}
          {results.results.length > 0 && (
            <div className="p-6 engine-panel rounded-lg">
              <h3 className="text-sm font-bold text-engine-text-secondary uppercase tracking-widest mb-4">
                Per-Symbol Breakdown
              </h3>
              <div className="grid gap-4">
                {results.results.map((result, i) => (
                  <div key={i} className="p-4 bg-engine-bg border border-engine-border rounded-md">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="status-dot-healthy" />
                        <p className="text-[11px] font-bold text-engine-text-primary">{result.symbol}</p>
                      </div>
                      <div className="text-[10px] font-mono text-engine-text-muted">{result.totalTrades} trades</div>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-[9px] font-mono">
                      <div>
                        <p className="text-engine-text-muted">Win Rate</p>
                        <p className="text-signal-buy font-bold">{result.winRate}%</p>
                      </div>
                      <div>
                        <p className="text-engine-text-muted">Wins/Loss</p>
                        <p className="font-bold">
                          <span className="text-signal-buy">{result.wins}</span>/
                          <span className="text-signal-sell">{result.losses}</span>
                        </p>
                      </div>
                      <div>
                        <p className="text-engine-text-muted">Net Profit</p>
                        <p className={`font-bold ${parseFloat(result.netProfit) > 0 ? "text-signal-buy" : "text-signal-sell"}`}>
                          ${result.netProfit}
                        </p>
                      </div>
                      <div>
                        <p className="text-engine-text-muted">Final Balance</p>
                        <p className="text-engine-text-primary font-bold">${result.finalBalance}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </motion.section>
    </AnimatePresence>
  );
}

function StatItem({
  label,
  value,
  className = "text-engine-text-primary",
  custom,
}: {
  label: string;
  value: string;
  className?: string;
  custom?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] text-engine-text-dim uppercase font-bold mb-1">{label}</p>
      {custom ?? <p className={`text-xl font-bold font-mono ${className}`}>{value}</p>}
    </div>
  );
}

function ConfigItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-engine-text-muted uppercase font-bold">{label}</p>
      <p className="text-engine-text-primary">{value}</p>
    </div>
  );
}
