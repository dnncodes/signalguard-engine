import { Zap, TrendingUp, TrendingDown, Clock } from "lucide-react";
import type { LiveAutomationStatus } from "@/types/engine";
import { SYMBOLS } from "@/types/engine";

interface LiveResultsProps {
  status: LiveAutomationStatus | null;
}

export function LiveResults({ status }: LiveResultsProps) {
  if (!status) return null;

  const { trades = [], totalProfit = 0, winCount = 0, lossCount = 0 } = status;
  const totalTrades = trades.length;

  return (
    <section className="space-y-6">
      <div className="p-6 engine-panel rounded-lg">
        <h3 className="engine-section-title mb-4">
          <Zap size={14} /> Live Automation Status
        </h3>

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatBox label="Status" value={status.running ? "RUNNING" : "STOPPED"} className={status.running ? "text-signal-buy" : "text-engine-text-muted"} />
          <StatBox label="Total Trades" value={String(totalTrades)} />
          <StatBox label="Win / Loss" value={`${winCount} / ${lossCount}`} className={winCount >= lossCount ? "text-signal-buy" : "text-signal-sell"} />
          <StatBox label="Total Profit" value={`$${totalProfit.toFixed(2)}`} className={totalProfit >= 0 ? "text-signal-buy" : "text-signal-sell"} />
        </div>

        {status.currentBalance != null && (
          <p className="text-[10px] font-mono text-engine-text-secondary">
            Current Balance: <strong>${status.currentBalance.toFixed(2)}</strong>
          </p>
        )}
      </div>

      {trades.length > 0 && (
        <div className="p-6 engine-panel rounded-lg">
          <h4 className="text-sm font-bold text-engine-text-secondary uppercase tracking-widest mb-4">
            Trades ({trades.length})
          </h4>
          <div className="overflow-x-auto rounded-md border border-engine-border bg-engine-bg max-h-80 overflow-y-auto">
            <table className="w-full text-left text-[9px] font-mono">
              <thead className="sticky top-0 bg-engine-bg/90 backdrop-blur-sm">
                <tr className="text-engine-text-dim border-b border-engine-border uppercase tracking-tighter">
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Symbol</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Contract</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-engine-border">
                {[...trades].reverse().map((t, i) => (
                  <tr key={i} className="hover:bg-engine-surface transition-colors">
                    <td className="px-3 py-2 text-engine-text-muted">
                      {new Date(t.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="px-3 py-2 text-engine-text-secondary font-bold">
                      {SYMBOLS[t.signal?.symbol || ""] || t.signal?.symbol || "-"}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`flex items-center gap-1 ${t.signal?.type === "BUY" ? "text-signal-buy" : "text-signal-sell"}`}>
                        {t.signal?.type === "BUY" ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                        {t.signal?.type ?? "-"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-engine-text-secondary">${t.tradeAmount.toFixed(2)}</td>
                    <td className="px-3 py-2 text-engine-text-muted">{t.contractId ? `#${t.contractId}` : "-"}</td>
                    <td className="px-3 py-2">
                      <TradeStatus status={t.status} />
                    </td>
                    <td className={`px-3 py-2 font-bold ${(t.profit || 0) >= 0 ? "text-signal-buy" : "text-signal-sell"}`}>
                      {t.profit != null && t.status === "SETTLED" ? `$${t.profit.toFixed(2)}` : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function StatBox({ label, value, className = "text-engine-text-primary" }: { label: string; value: string; className?: string }) {
  return (
    <div className="p-3 bg-engine-bg rounded-md border border-engine-border">
      <p className="text-[8px] text-engine-text-dim uppercase font-bold mb-1">{label}</p>
      <p className={`text-sm font-mono font-bold ${className}`}>{value}</p>
    </div>
  );
}

function TradeStatus({ status }: { status?: string }) {
  if (status === "PENDING") {
    return (
      <span className="flex items-center gap-1 text-yellow-400">
        <Clock size={10} className="animate-pulse" /> PENDING
      </span>
    );
  }
  if (status === "SETTLED" || status === "WON") {
    return <span className="text-signal-buy font-bold">SETTLED</span>;
  }
  if (status === "LOST") {
    return <span className="text-signal-sell font-bold">SETTLED</span>;
  }
  return <span className="text-engine-text-muted">-</span>;
}
