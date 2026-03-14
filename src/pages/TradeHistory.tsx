import { useState } from "react";
import { Link } from "react-router-dom";
import {
  History,
  ArrowLeft,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Clock,
  DollarSign,
  BarChart3,
} from "lucide-react";
import { useTradeHistory } from "@/hooks/useEngine";
import { SYMBOLS } from "@/types/engine";

export default function TradeHistory() {
  const { trades, backtests, loading, reload } = useTradeHistory();
  const [tab, setTab] = useState<"trades" | "backtests">("trades");

  return (
    <div className="min-h-screen bg-engine-bg text-engine-text-primary font-sans">
      {/* Header */}
      <header className="border-b border-engine-border bg-engine-bg/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="p-2 hover:bg-engine-surface-hover rounded-md transition-all"
            >
              <ArrowLeft size={18} className="text-engine-text-muted" />
            </Link>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-signal-buy-bg rounded-md flex items-center justify-center">
                <History size={16} className="text-signal-buy" />
              </div>
              <h1 className="text-base font-black tracking-tight text-engine-text-primary">
                TRADE HISTORY
              </h1>
            </div>
          </div>
          <button
            onClick={reload}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-engine-surface hover:bg-engine-surface-hover border border-engine-border rounded-md text-[10px] font-bold uppercase tracking-widest text-engine-text-muted hover:text-engine-text-secondary transition-all"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-8">
        {/* Tabs */}
        <div className="flex gap-1 mb-8 p-1 bg-engine-surface rounded-lg w-fit border border-engine-border">
          <button
            onClick={() => setTab("trades")}
            className={`px-6 py-2.5 rounded-md text-xs font-bold uppercase tracking-widest transition-all ${
              tab === "trades"
                ? "bg-signal-buy text-engine-bg shadow-lg shadow-signal-buy/20"
                : "text-engine-text-muted hover:text-engine-text-secondary"
            }`}
          >
            Live Trades ({trades.length})
          </button>
          <button
            onClick={() => setTab("backtests")}
            className={`px-6 py-2.5 rounded-md text-xs font-bold uppercase tracking-widest transition-all ${
              tab === "backtests"
                ? "bg-signal-buy text-engine-bg shadow-lg shadow-signal-buy/20"
                : "text-engine-text-muted hover:text-engine-text-secondary"
            }`}
          >
            Backtests ({backtests.length})
          </button>
        </div>

        {loading ? (
          <div className="h-64 flex flex-col items-center justify-center border border-dashed border-engine-border rounded-lg text-engine-text-dim">
            <RefreshCw size={32} className="mb-4 animate-spin opacity-20" />
            <p className="text-xs uppercase tracking-widest font-bold font-mono">
              Loading history...
            </p>
          </div>
        ) : tab === "trades" ? (
          <TradesTable trades={trades} />
        ) : (
          <BacktestsTable backtests={backtests} />
        )}
      </main>
    </div>
  );
}

// ─── Trades Table ────────────────────────────────────────────

function TradesTable({ trades }: { trades: any[] }) {
  if (trades.length === 0) {
    return (
      <div className="h-64 flex flex-col items-center justify-center border border-dashed border-engine-border rounded-lg text-engine-text-dim">
        <DollarSign size={48} className="mb-4 opacity-10" />
        <p className="text-xs uppercase tracking-widest font-bold">No trades yet</p>
        <p className="text-[10px] mt-2 text-engine-text-muted">
          Execute a test trade from the dashboard to see it here
        </p>
      </div>
    );
  }

  return (
    <div className="engine-panel rounded-lg overflow-hidden">
      <div className="p-6 border-b border-engine-border">
        <div className="flex items-center gap-3">
          <DollarSign size={16} className="text-signal-buy" />
          <h2 className="text-sm font-bold uppercase tracking-widest text-engine-text-primary">
            All Trades
          </h2>
        </div>
      </div>
      <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
        <table className="w-full text-left text-[10px] font-mono">
          <thead className="sticky top-0 bg-engine-bg/95 backdrop-blur-sm">
            <tr className="text-engine-text-dim border-b border-engine-border uppercase tracking-tighter">
              <th className="px-4 py-3 font-medium">Time</th>
              <th className="px-4 py-3 font-medium">Symbol</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Contract</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Entry</th>
              <th className="px-4 py-3 font-medium">Exit</th>
              <th className="px-4 py-3 font-medium">Result</th>
              <th className="px-4 py-3 font-medium">Profit</th>
              <th className="px-4 py-3 font-medium">Balance</th>
              <th className="px-4 py-3 font-medium">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-engine-border">
            {trades.map((t) => {
              const isWin = t.result === "WIN";
              const isPending = t.result === "PENDING";
              return (
                <tr key={t.id} className="hover:bg-engine-surface transition-colors">
                  <td className="px-4 py-3 text-engine-text-muted whitespace-nowrap">
                    {new Date(t.created_at).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-3 text-engine-text-secondary font-bold">
                    {SYMBOLS[t.symbol] || t.symbol}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`flex items-center gap-1 ${
                      t.trade_type === "BUY" ? "text-signal-buy" : "text-signal-sell"
                    }`}>
                      {t.trade_type === "BUY" ? (
                        <TrendingUp size={10} />
                      ) : (
                        <TrendingDown size={10} />
                      )}
                      {t.trade_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-engine-text-muted">{t.contract_type}</td>
                  <td className="px-4 py-3 text-engine-text-secondary">
                    {t.currency} ${Number(t.amount).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-engine-text-secondary">
                    {t.entry_price ? Number(t.entry_price).toFixed(2) : "—"}
                  </td>
                  <td className="px-4 py-3 text-engine-text-secondary">
                    {t.exit_price ? Number(t.exit_price).toFixed(2) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-sm text-[9px] font-black ${
                        isPending
                          ? "bg-warning/10 text-warning"
                          : isWin
                          ? "bg-signal-buy-bg text-signal-buy"
                          : "bg-signal-sell-bg text-signal-sell"
                      }`}
                    >
                      {t.result || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={t.profit > 0 ? "text-signal-buy" : t.profit < 0 ? "text-signal-sell" : "text-engine-text-muted"}>
                      {t.profit != null ? `$${Number(t.profit).toFixed(2)}` : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-engine-text-primary font-bold">
                    {t.balance_after != null ? `$${Number(t.balance_after).toFixed(2)}` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-sm text-[9px] bg-engine-surface text-engine-text-muted">
                      {t.source}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Backtests Table ─────────────────────────────────────────

function BacktestsTable({ backtests }: { backtests: any[] }) {
  if (backtests.length === 0) {
    return (
      <div className="h-64 flex flex-col items-center justify-center border border-dashed border-engine-border rounded-lg text-engine-text-dim">
        <BarChart3 size={48} className="mb-4 opacity-10" />
        <p className="text-xs uppercase tracking-widest font-bold">No backtests yet</p>
        <p className="text-[10px] mt-2 text-engine-text-muted">
          Run a backtest from the dashboard to see sessions here
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {backtests.map((bt) => {
        const isProfitable = bt.is_profitable;
        const netProfit = bt.net_profit != null ? Number(bt.net_profit) : 0;

        return (
          <div
            key={bt.id}
            className={`engine-panel rounded-lg p-6 border-l-4 ${
              isProfitable ? "border-l-signal-buy" : "border-l-signal-sell"
            }`}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Clock size={12} className="text-engine-text-muted" />
                  <span className="text-[10px] text-engine-text-muted font-mono">
                    {new Date(bt.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="flex gap-2 flex-wrap mt-2">
                  {bt.symbols?.map((s: string) => (
                    <span
                      key={s}
                      className="px-2 py-0.5 rounded-sm text-[9px] bg-engine-surface text-engine-text-secondary border border-engine-border"
                    >
                      {SYMBOLS[s] || s}
                    </span>
                  ))}
                </div>
              </div>
              <div className="text-right">
                <div
                  className={`text-2xl font-black font-mono ${
                    isProfitable ? "text-signal-buy" : "text-signal-sell"
                  }`}
                >
                  {isProfitable ? "+" : ""}${netProfit.toFixed(2)}
                </div>
                <span
                  className={`text-[9px] font-bold ${
                    isProfitable ? "text-signal-buy" : "text-signal-sell"
                  }`}
                >
                  {isProfitable ? "PROFITABLE" : "LOSS"}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-[10px] font-mono">
              <div>
                <p className="text-engine-text-muted uppercase font-bold">Trades</p>
                <p className="text-engine-text-primary font-bold">{bt.total_trades || 0}</p>
              </div>
              <div>
                <p className="text-engine-text-muted uppercase font-bold">Win Rate</p>
                <p className="text-signal-buy font-bold">{bt.win_rate || "0%"}</p>
              </div>
              <div>
                <p className="text-engine-text-muted uppercase font-bold">W / L</p>
                <p className="font-bold">
                  <span className="text-signal-buy">{bt.total_wins || 0}</span>
                  {" / "}
                  <span className="text-signal-sell">{bt.total_losses || 0}</span>
                </p>
              </div>
              <div>
                <p className="text-engine-text-muted uppercase font-bold">Max DD</p>
                <p className="text-signal-sell font-bold">{bt.max_drawdown || "0%"}</p>
              </div>
              <div>
                <p className="text-engine-text-muted uppercase font-bold">Duration</p>
                <p className="text-engine-text-primary font-bold">{bt.duration_hours}h / {bt.timeframe_minutes}m</p>
              </div>
              <div>
                <p className="text-engine-text-muted uppercase font-bold">Final Bal.</p>
                <p className="text-engine-text-primary font-bold">
                  ${bt.final_balance != null ? Number(bt.final_balance).toFixed(2) : "—"}
                </p>
              </div>
            </div>

            {bt.stop_reason && (
              <p className="mt-3 text-[9px] text-warning italic font-mono">
                Stop reason: {bt.stop_reason}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
