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
  FlaskConical,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useTradeHistory } from "@/hooks/useEngine";
import { SYMBOLS } from "@/types/engine";

export default function TradeHistory() {
  const { trades, backtests, loading, reload } = useTradeHistory();
  const [tab, setTab] = useState<"live" | "backtests">("live");
  const [showTestTrades, setShowTestTrades] = useState(false);

  const liveTrades = trades.filter((t) => t.source === "automation" || t.source === "manual");
  const testTrades = trades.filter((t) => t.source === "test");

  return (
    <div className="min-h-screen bg-[hsl(var(--engine-bg))] text-[hsl(var(--engine-text-primary))] font-sans">
      {/* Header */}
      <header className="border-b border-[hsl(var(--engine-border))] bg-[hsl(var(--engine-bg)/0.8)] backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/" className="p-2 hover:bg-[hsl(var(--engine-surface-hover))] rounded-md transition-all">
              <ArrowLeft size={18} className="text-[hsl(var(--engine-text-muted))]" />
            </Link>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-[hsl(var(--signal-buy-bg))] rounded-md flex items-center justify-center">
                <History size={16} className="text-[hsl(var(--signal-buy))]" />
              </div>
              <h1 className="text-base font-black tracking-tight">TRADE HISTORY</h1>
            </div>
          </div>
          <button
            onClick={reload}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-[hsl(var(--engine-surface))] hover:bg-[hsl(var(--engine-surface-hover))] border border-[hsl(var(--engine-border))] rounded-md text-[10px] font-bold uppercase tracking-widest text-[hsl(var(--engine-text-muted))] hover:text-[hsl(var(--engine-text-secondary))] transition-all"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-8">
        {/* Tabs */}
        <div className="flex gap-1 mb-8 p-1 bg-[hsl(var(--engine-surface))] rounded-lg w-fit border border-[hsl(var(--engine-border))]">
          <button
            onClick={() => setTab("live")}
            className={`px-6 py-2.5 rounded-md text-xs font-bold uppercase tracking-widest transition-all ${
              tab === "live"
                ? "bg-[hsl(var(--signal-buy))] text-[hsl(var(--engine-bg))] shadow-lg"
                : "text-[hsl(var(--engine-text-muted))] hover:text-[hsl(var(--engine-text-secondary))]"
            }`}
          >
            <DollarSign size={12} className="inline mr-1" />
            Live Trades ({liveTrades.length})
          </button>
          <button
            onClick={() => setTab("backtests")}
            className={`px-6 py-2.5 rounded-md text-xs font-bold uppercase tracking-widest transition-all ${
              tab === "backtests"
                ? "bg-[hsl(var(--signal-buy))] text-[hsl(var(--engine-bg))] shadow-lg"
                : "text-[hsl(var(--engine-text-muted))] hover:text-[hsl(var(--engine-text-secondary))]"
            }`}
          >
            <BarChart3 size={12} className="inline mr-1" />
            Backtests ({backtests.length})
          </button>
        </div>

        {loading ? (
          <div className="h-64 flex flex-col items-center justify-center border border-dashed border-[hsl(var(--engine-border))] rounded-lg text-[hsl(var(--engine-text-dim))]">
            <RefreshCw size={32} className="mb-4 animate-spin opacity-20" />
            <p className="text-xs uppercase tracking-widest font-bold font-mono">Loading history...</p>
          </div>
        ) : tab === "live" ? (
          <div className="space-y-6">
            <TradesTable trades={liveTrades} title="Live & Manual Trades" icon={<DollarSign size={16} className="text-[hsl(var(--signal-buy))]" />} />
            
            {/* Test Trades Toggle */}
            <button
              onClick={() => setShowTestTrades(!showTestTrades)}
              className="flex items-center gap-2 px-4 py-2.5 bg-[hsl(var(--engine-surface))] hover:bg-[hsl(var(--engine-surface-hover))] border border-[hsl(var(--engine-border))] rounded-md text-[10px] font-bold uppercase tracking-widest text-[hsl(var(--engine-text-muted))] hover:text-[hsl(var(--engine-text-secondary))] transition-all"
            >
              <FlaskConical size={12} />
              {showTestTrades ? "Hide" : "Show"} Test Trades ({testTrades.length})
              {showTestTrades ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>

            {showTestTrades && (
              <TradesTable trades={testTrades} title="Test Trades" icon={<FlaskConical size={16} className="text-[hsl(var(--status-info))]" />} />
            )}
          </div>
        ) : (
          <BacktestsTable backtests={backtests} />
        )}
      </main>
    </div>
  );
}

// ─── Trades Table ────────────────────────────────────────────

function TradesTable({ trades, title, icon }: { trades: any[]; title: string; icon: React.ReactNode }) {
  if (trades.length === 0) {
    return (
      <div className="h-48 flex flex-col items-center justify-center border border-dashed border-[hsl(var(--engine-border))] rounded-lg text-[hsl(var(--engine-text-dim))]">
        <DollarSign size={36} className="mb-3 opacity-10" />
        <p className="text-xs uppercase tracking-widest font-bold">No {title.toLowerCase()} yet</p>
      </div>
    );
  }

  return (
    <div className="engine-panel rounded-lg overflow-hidden">
      <div className="p-5 border-b border-[hsl(var(--engine-border))]">
        <div className="flex items-center gap-3">
          {icon}
          <h2 className="text-sm font-bold uppercase tracking-widest">{title}</h2>
          <span className="ml-auto text-[10px] font-mono text-[hsl(var(--engine-text-dim))]">{trades.length} records</span>
        </div>
      </div>
      <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
        <table className="w-full text-left text-[10px] font-mono">
          <thead className="sticky top-0 bg-[hsl(var(--engine-bg)/0.95)] backdrop-blur-sm">
            <tr className="text-[hsl(var(--engine-text-dim))] border-b border-[hsl(var(--engine-border))] uppercase tracking-tighter">
              <th className="px-4 py-3 font-medium">Time</th>
              <th className="px-4 py-3 font-medium">Symbol</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Entry</th>
              <th className="px-4 py-3 font-medium">Exit</th>
              <th className="px-4 py-3 font-medium">Result</th>
              <th className="px-4 py-3 font-medium">Profit</th>
              <th className="px-4 py-3 font-medium">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--engine-border))]">
            {trades.map((t) => {
              const isWin = t.result === "WIN";
              const isPending = t.result === "PENDING";
              return (
                <tr key={t.id} className="hover:bg-[hsl(var(--engine-surface))] transition-colors">
                  <td className="px-4 py-3 text-[hsl(var(--engine-text-muted))] whitespace-nowrap">
                    {new Date(t.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-4 py-3 text-[hsl(var(--engine-text-secondary))] font-bold">
                    {SYMBOLS[t.symbol] || t.symbol}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`flex items-center gap-1 ${t.trade_type === "BUY" ? "text-[hsl(var(--signal-buy))]" : "text-[hsl(var(--signal-sell))]"}`}>
                      {t.trade_type === "BUY" ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                      {t.trade_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[hsl(var(--engine-text-secondary))]">${Number(t.amount).toFixed(2)}</td>
                  <td className="px-4 py-3 text-[hsl(var(--engine-text-secondary))]">{t.entry_price ? Number(t.entry_price).toFixed(2) : "—"}</td>
                  <td className="px-4 py-3 text-[hsl(var(--engine-text-secondary))]">{t.exit_price ? Number(t.exit_price).toFixed(2) : "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-sm text-[9px] font-black ${
                      isPending ? "bg-[hsl(var(--warning)/0.1)] text-[hsl(var(--warning))]"
                      : isWin ? "bg-[hsl(var(--signal-buy-bg))] text-[hsl(var(--signal-buy))]"
                      : "bg-[hsl(var(--signal-sell-bg))] text-[hsl(var(--signal-sell))]"
                    }`}>
                      {t.result || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={t.profit > 0 ? "text-[hsl(var(--signal-buy))]" : t.profit < 0 ? "text-[hsl(var(--signal-sell))]" : "text-[hsl(var(--engine-text-muted))]"}>
                      {t.profit != null ? `$${Number(t.profit).toFixed(2)}` : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-bold">{t.balance_after != null ? `$${Number(t.balance_after).toFixed(2)}` : "—"}</td>
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
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  if (backtests.length === 0) {
    return (
      <div className="h-64 flex flex-col items-center justify-center border border-dashed border-[hsl(var(--engine-border))] rounded-lg text-[hsl(var(--engine-text-dim))]">
        <BarChart3 size={48} className="mb-4 opacity-10" />
        <p className="text-xs uppercase tracking-widest font-bold">No backtests yet</p>
      </div>
    );
  }

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="grid gap-4">
      {backtests.map((bt) => {
        const isProfitable = bt.is_profitable;
        const netProfit = bt.net_profit != null ? Number(bt.net_profit) : 0;
        const isExpanded = expandedIds.has(bt.id);
        const allTrades = bt.results?.allTrades || [];

        return (
          <div
            key={bt.id}
            className={`engine-panel rounded-lg border-l-4 ${
              isProfitable ? "border-l-[hsl(var(--signal-buy))]" : "border-l-[hsl(var(--signal-sell))]"
            }`}
          >
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Clock size={12} className="text-[hsl(var(--engine-text-muted))]" />
                    <span className="text-[10px] text-[hsl(var(--engine-text-muted))] font-mono">
                      {new Date(bt.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex gap-2 flex-wrap mt-2">
                    {bt.symbols?.map((s: string) => (
                      <span key={s} className="px-2 py-0.5 rounded-sm text-[9px] bg-[hsl(var(--engine-surface))] text-[hsl(var(--engine-text-secondary))] border border-[hsl(var(--engine-border))]">
                        {SYMBOLS[s] || s}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-2xl font-black font-mono ${isProfitable ? "text-[hsl(var(--signal-buy))]" : "text-[hsl(var(--signal-sell))]"}`}>
                    {isProfitable ? "+" : ""}${netProfit.toFixed(2)}
                  </div>
                  <span className={`text-[9px] font-bold ${isProfitable ? "text-[hsl(var(--signal-buy))]" : "text-[hsl(var(--signal-sell))]"}`}>
                    {isProfitable ? "PROFITABLE" : "LOSS"}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-[10px] font-mono">
                <div>
                  <p className="text-[hsl(var(--engine-text-muted))] uppercase font-bold">Trades</p>
                  <p className="font-bold">{bt.total_trades || 0}</p>
                </div>
                <div>
                  <p className="text-[hsl(var(--engine-text-muted))] uppercase font-bold">Win Rate</p>
                  <p className="text-[hsl(var(--signal-buy))] font-bold">{bt.win_rate || "0%"}</p>
                </div>
                <div>
                  <p className="text-[hsl(var(--engine-text-muted))] uppercase font-bold">W / L</p>
                  <p className="font-bold">
                    <span className="text-[hsl(var(--signal-buy))]">{bt.total_wins || 0}</span>
                    {" / "}
                    <span className="text-[hsl(var(--signal-sell))]">{bt.total_losses || 0}</span>
                  </p>
                </div>
                <div>
                  <p className="text-[hsl(var(--engine-text-muted))] uppercase font-bold">Max DD</p>
                  <p className="text-[hsl(var(--signal-sell))] font-bold">{bt.max_drawdown || "0%"}</p>
                </div>
                <div>
                  <p className="text-[hsl(var(--engine-text-muted))] uppercase font-bold">Duration</p>
                  <p className="font-bold">{bt.duration_hours}h / {bt.timeframe_minutes}m</p>
                </div>
                <div>
                  <p className="text-[hsl(var(--engine-text-muted))] uppercase font-bold">Final Bal.</p>
                  <p className="font-bold">${bt.final_balance != null ? Number(bt.final_balance).toFixed(2) : "—"}</p>
                </div>
              </div>

              {bt.stop_reason && (
                <p className="mt-3 text-[9px] text-[hsl(var(--warning))] italic font-mono">
                  Stop reason: {bt.stop_reason}
                </p>
              )}
            </div>

            {/* Expandable Trade Log */}
            {allTrades.length > 0 && (
              <>
                <div className="px-6 pb-3">
                  <button
                    onClick={() => toggleExpand(bt.id)}
                    className="flex items-center gap-2 px-4 py-2 bg-[hsl(var(--engine-surface))] hover:bg-[hsl(var(--engine-surface-hover))] border border-[hsl(var(--engine-border))] rounded-md text-[10px] font-bold uppercase tracking-widest text-[hsl(var(--engine-text-muted))] hover:text-[hsl(var(--engine-text-secondary))] transition-all"
                  >
                    <History size={12} />
                    {isExpanded ? "Hide" : "Show"} Trade Log ({allTrades.length})
                    {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                </div>

                {isExpanded && (
                  <div className="border-t border-[hsl(var(--engine-border))]">
                    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                      <table className="w-full text-left text-[9px] font-mono">
                        <thead className="sticky top-0 bg-[hsl(var(--engine-bg)/0.95)] backdrop-blur-sm">
                          <tr className="text-[hsl(var(--engine-text-dim))] border-b border-[hsl(var(--engine-border))] uppercase tracking-tighter">
                            <th className="px-3 py-2 font-medium">#</th>
                            <th className="px-3 py-2 font-medium">Time</th>
                            <th className="px-3 py-2 font-medium">Symbol</th>
                            <th className="px-3 py-2 font-medium">Type</th>
                            <th className="px-3 py-2 font-medium">Amount</th>
                            <th className="px-3 py-2 font-medium">Entry</th>
                            <th className="px-3 py-2 font-medium">Exit</th>
                            <th className="px-3 py-2 font-medium">Result</th>
                            <th className="px-3 py-2 font-medium">Profit</th>
                            <th className="px-3 py-2 font-medium">Balance</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[hsl(var(--engine-border))]">
                          {allTrades.map((trade: any, i: number) => {
                            const isWin = trade.result === "WIN";
                            const payout = trade.tradeAmount * 0.85;
                            const profit = isWin ? payout : -trade.tradeAmount;
                            return (
                              <tr key={i} className="hover:bg-[hsl(var(--engine-surface))] transition-colors">
                                <td className="px-3 py-2 text-[hsl(var(--engine-text-dim))]">{i + 1}</td>
                                <td className="px-3 py-2 text-[hsl(var(--engine-text-muted))] whitespace-nowrap">
                                  {trade.executionTime ? new Date(trade.executionTime).toLocaleString([], {
                                    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
                                  }) : "—"}
                                </td>
                                <td className="px-3 py-2 text-[hsl(var(--engine-text-secondary))] font-bold">
                                  {SYMBOLS[trade.symbol] || trade.symbol}
                                </td>
                                <td className="px-3 py-2">
                                  <span className={`flex items-center gap-1 ${trade.type === "BUY" ? "text-[hsl(var(--signal-buy))]" : "text-[hsl(var(--signal-sell))]"}`}>
                                    {trade.type === "BUY" ? <TrendingUp size={8} /> : <TrendingDown size={8} />}
                                    {trade.type}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-[hsl(var(--engine-text-secondary))]">
                                  ${Number(trade.tradeAmount || 0).toFixed(2)}
                                </td>
                                <td className="px-3 py-2 text-[hsl(var(--engine-text-secondary))]">
                                  {Number(trade.entryPrice || 0).toFixed(4)}
                                </td>
                                <td className="px-3 py-2 text-[hsl(var(--engine-text-secondary))]">
                                  {Number(trade.exitPrice || 0).toFixed(4)}
                                </td>
                                <td className="px-3 py-2">
                                  <span className={`px-2 py-0.5 rounded-sm text-[8px] font-black ${
                                    isWin
                                      ? "bg-[hsl(var(--signal-buy-bg))] text-[hsl(var(--signal-buy))]"
                                      : "bg-[hsl(var(--signal-sell-bg))] text-[hsl(var(--signal-sell))]"
                                  }`}>
                                    {trade.result}
                                  </span>
                                </td>
                                <td className="px-3 py-2">
                                  <span className={isWin ? "text-[hsl(var(--signal-buy))]" : "text-[hsl(var(--signal-sell))]"}>
                                    {isWin ? "+" : ""}${profit.toFixed(2)}
                                  </span>
                                </td>
                                <td className="px-3 py-2 font-bold text-[hsl(var(--engine-text-primary))]">
                                  ${Number(trade.newBalance || 0).toFixed(2)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
