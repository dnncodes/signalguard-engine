import { useState, useMemo } from "react";
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
  Wrench,
  ChevronDown,
  ChevronUp,
  Trash2,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";
import { useTradeHistory } from "@/hooks/useEngine";
import { SYMBOLS } from "@/types/engine";
import * as api from "@/services/api";

export default function TradeHistory() {
  const { trades, backtests, loading, reload } = useTradeHistory();
  const [tab, setTab] = useState<"live" | "manual" | "backtests">("live");
  const [deletingIds, setDeletingIds] = useState<Set<number | string>>(new Set());

  const liveTrades = trades.filter((t) => t.source === "automation");
  const manualTrades = trades.filter((t) => t.source === "manual" || t.source === "test");

  const handleDeleteTrade = async (id: number) => {
    if (deletingIds.has(id)) return;
    setDeletingIds((prev) => new Set(prev).add(id));
    try {
      await api.deleteTradeLog(id);
      toast.success("Trade log deleted");
      reload();
    } catch (err) {
      toast.error("Failed to delete trade log");
    } finally {
      setDeletingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const handleDeleteBacktest = async (id: string) => {
    if (deletingIds.has(id)) return;
    setDeletingIds((prev) => new Set(prev).add(id));
    try {
      await api.deleteBacktestSession(id);
      toast.success("Backtest session deleted");
      reload();
    } catch (err) {
      toast.error("Failed to delete backtest");
    } finally {
      setDeletingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const handleDeleteAllTrades = async (tradeList: any[]) => {
    if (tradeList.length === 0) return;
    const ids = tradeList.map((t) => t.id);
    try {
      await api.deleteTradeLogsBatch(ids);
      toast.success(`${ids.length} trade logs deleted`);
      reload();
    } catch {
      toast.error("Failed to delete trade logs");
    }
  };

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
        {/* Summary Stats Bar */}
        {!loading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatCard
              label="Total Trades"
              value={String(trades.length)}
              icon={<BarChart3 size={14} className="text-[hsl(var(--status-info))]" />}
            />
            <StatCard
              label="Win Rate"
              value={(() => {
                const settled = trades.filter((t) => t.result === "WIN" || t.result === "LOSS");
                const wins = settled.filter((t) => t.result === "WIN").length;
                return settled.length > 0 ? `${((wins / settled.length) * 100).toFixed(1)}%` : "—";
              })()}
              icon={<TrendingUp size={14} className="text-[hsl(var(--signal-buy))]" />}
            />
            <StatCard
              label="Net P&L"
              value={(() => {
                const pnl = trades.reduce((sum, t) => sum + (t.profit || 0), 0);
                return `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`;
              })()}
              icon={<DollarSign size={14} className="text-[hsl(var(--signal-buy))]" />}
              positive={trades.reduce((sum, t) => sum + (t.profit || 0), 0) >= 0}
            />
            <StatCard
              label="Sessions"
              value={String(backtests.length)}
              icon={<Clock size={14} className="text-[hsl(var(--engine-text-muted))]" />}
            />
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-8 p-1 bg-[hsl(var(--engine-surface))] rounded-lg w-fit border border-[hsl(var(--engine-border))]">
          <TabButton active={tab === "live"} onClick={() => setTab("live")} icon={<DollarSign size={12} />} label={`Automated (${liveTrades.length})`} />
          <TabButton active={tab === "manual"} onClick={() => setTab("manual")} icon={<Wrench size={12} />} label={`Manual (${manualTrades.length})`} />
          <TabButton active={tab === "backtests"} onClick={() => setTab("backtests")} icon={<BarChart3 size={12} />} label={`Backtests (${backtests.length})`} />
        </div>

        {loading ? (
          <div className="h-64 flex flex-col items-center justify-center border border-dashed border-[hsl(var(--engine-border))] rounded-lg text-[hsl(var(--engine-text-dim))]">
            <RefreshCw size={32} className="mb-4 animate-spin opacity-20" />
            <p className="text-xs uppercase tracking-widest font-bold font-mono">Loading history...</p>
          </div>
        ) : tab === "live" ? (
          <SessionGroupedTrades
            trades={liveTrades}
            title="Automated Trades"
            icon={<DollarSign size={16} className="text-[hsl(var(--signal-buy))]" />}
            onDeleteTrade={handleDeleteTrade}
            onDeleteAll={() => handleDeleteAllTrades(liveTrades)}
            deletingIds={deletingIds}
          />
        ) : tab === "manual" ? (
          <SessionGroupedTrades
            trades={manualTrades}
            title="Manual Trades"
            icon={<Wrench size={16} className="text-[hsl(var(--status-info))]" />}
            onDeleteTrade={handleDeleteTrade}
            onDeleteAll={() => handleDeleteAllTrades(manualTrades)}
            deletingIds={deletingIds}
          />
        ) : (
          <BacktestsTable backtests={backtests} onDelete={handleDeleteBacktest} deletingIds={deletingIds} />
        )}
      </main>
    </div>
  );
}

// ─── Stat Card ───────────────────────────────────────────────

function StatCard({ label, value, icon, positive }: { label: string; value: string; icon: React.ReactNode; positive?: boolean }) {
  return (
    <div className="engine-panel rounded-lg p-4 flex items-center gap-3">
      <div className="w-8 h-8 rounded-md bg-[hsl(var(--engine-surface))] flex items-center justify-center">{icon}</div>
      <div>
        <p className="text-[8px] text-[hsl(var(--engine-text-dim))] font-mono font-bold uppercase tracking-widest">{label}</p>
        <p className={`text-sm font-black font-mono ${positive === true ? "text-[hsl(var(--signal-buy))]" : positive === false ? "text-[hsl(var(--signal-sell))]" : "text-[hsl(var(--engine-text-primary))]"}`}>
          {value}
        </p>
      </div>
    </div>
  );
}

// ─── Tab Button ──────────────────────────────────────────────

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-5 py-2.5 rounded-md text-xs font-bold uppercase tracking-widest transition-all flex items-center gap-1.5 ${
        active
          ? "bg-[hsl(var(--signal-buy))] text-[hsl(var(--engine-bg))] shadow-lg"
          : "text-[hsl(var(--engine-text-muted))] hover:text-[hsl(var(--engine-text-secondary))]"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ─── Session Grouped Trades (for automated) ──────────────────

function SessionGroupedTrades({
  trades,
  title,
  icon,
  onDeleteTrade,
  onDeleteAll,
  deletingIds,
}: {
  trades: any[];
  title: string;
  icon: React.ReactNode;
  onDeleteTrade: (id: number) => void;
  onDeleteAll: () => void;
  deletingIds: Set<number | string>;
}) {
  // Group trades into sessions: a session is a group of trades within a 2-hour gap
  const sessions = useMemo(() => {
    if (trades.length === 0) return [];

    const SESSION_GAP_MS = 2 * 60 * 60 * 1000; // 2 hours gap = new session
    const sorted = [...trades].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    const groups: { id: string; startTime: Date; endTime: Date; trades: any[] }[] = [];
    let current: typeof groups[0] | null = null;

    for (const trade of sorted) {
      const tradeTime = new Date(trade.created_at);
      if (!current || tradeTime.getTime() - current.endTime.getTime() > SESSION_GAP_MS) {
        current = {
          id: `session-${tradeTime.getTime()}`,
          startTime: tradeTime,
          endTime: tradeTime,
          trades: [trade],
        };
        groups.push(current);
      } else {
        current.trades.push(trade);
        current.endTime = tradeTime;
      }
    }

    // Reverse so newest session is first
    groups.reverse();
    // Also reverse trades within each session so newest trade is first
    for (const g of groups) g.trades.reverse();
    return groups;
  }, [trades]);

  const [collapsedSessions, setCollapsedSessions] = useState<Set<string>>(new Set());

  if (trades.length === 0) {
    return (
      <div className="h-48 flex flex-col items-center justify-center border border-dashed border-[hsl(var(--engine-border))] rounded-lg text-[hsl(var(--engine-text-dim))]">
        <DollarSign size={36} className="mb-3 opacity-10" />
        <p className="text-xs uppercase tracking-widest font-bold">No {title.toLowerCase()} yet</p>
      </div>
    );
  }

  const toggleSession = (id: string) => {
    setCollapsedSessions((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {icon}
          <h2 className="text-sm font-bold uppercase tracking-widest">{title}</h2>
          <span className="text-[10px] font-mono text-[hsl(var(--engine-text-dim))]">{trades.length} records · {sessions.length} sessions</span>
        </div>
        <button
          onClick={onDeleteAll}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[hsl(var(--signal-sell)/0.08)] hover:bg-[hsl(var(--signal-sell)/0.15)] border border-[hsl(var(--signal-sell)/0.2)] rounded-md text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--signal-sell))] transition-all"
        >
          <Trash2 size={10} />
          Clear All
        </button>
      </div>

      {sessions.map((session) => {
        const isCollapsed = collapsedSessions.has(session.id);
        const sessionWins = session.trades.filter((t: any) => t.result === "WIN").length;
        const sessionLosses = session.trades.filter((t: any) => t.result === "LOSS").length;
        const sessionProfit = session.trades.reduce((sum: number, t: any) => sum + (t.profit || 0), 0);
        const isProfitable = sessionProfit >= 0;

        const formatDate = (d: Date) =>
          d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
        const formatTime = (d: Date) =>
          d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

        const isSameDay = session.startTime.toDateString() === session.endTime.toDateString();

        return (
          <div key={session.id} className={`engine-panel rounded-lg overflow-hidden border-l-4 ${isProfitable ? "border-l-[hsl(var(--signal-buy))]" : "border-l-[hsl(var(--signal-sell))]"}`}>
            {/* Session Header */}
            <button
              onClick={() => toggleSession(session.id)}
              className="w-full p-4 flex items-center justify-between hover:bg-[hsl(var(--engine-surface-hover))] transition-all"
            >
              <div className="flex items-center gap-3">
                <Calendar size={14} className="text-[hsl(var(--engine-text-muted))]" />
                <div className="text-left">
                  <p className="text-[11px] font-bold text-[hsl(var(--engine-text-secondary))]">
                    {formatDate(session.startTime)} · {formatTime(session.startTime)} — {isSameDay ? formatTime(session.endTime) : `${formatDate(session.endTime)} ${formatTime(session.endTime)}`}
                  </p>
                  <p className="text-[9px] font-mono text-[hsl(var(--engine-text-dim))]">
                    {session.trades.length} trades · <span className="text-[hsl(var(--signal-buy))]">{sessionWins}W</span> / <span className="text-[hsl(var(--signal-sell))]">{sessionLosses}L</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-sm font-black font-mono ${isProfitable ? "text-[hsl(var(--signal-buy))]" : "text-[hsl(var(--signal-sell))]"}`}>
                  {isProfitable ? "+" : ""}${sessionProfit.toFixed(2)}
                </span>
                {isCollapsed ? <ChevronDown size={14} className="text-[hsl(var(--engine-text-dim))]" /> : <ChevronUp size={14} className="text-[hsl(var(--engine-text-dim))]" />}
              </div>
            </button>

            {/* Session Trades */}
            {!isCollapsed && (
              <div className="border-t border-[hsl(var(--engine-border))]">
                <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
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
                        <th className="px-4 py-3 font-medium w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[hsl(var(--engine-border))]">
                      {session.trades.map((t: any) => (
                        <TradeRow key={t.id} t={t} onDelete={onDeleteTrade} deleting={deletingIds.has(t.id)} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Trades Table (for manual) ───────────────────────────────

function TradesTable({
  trades,
  title,
  icon,
  onDeleteTrade,
  onDeleteAll,
  deletingIds,
}: {
  trades: any[];
  title: string;
  icon: React.ReactNode;
  onDeleteTrade: (id: number) => void;
  onDeleteAll: () => void;
  deletingIds: Set<number | string>;
}) {
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
          <button
            onClick={onDeleteAll}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[hsl(var(--signal-sell)/0.08)] hover:bg-[hsl(var(--signal-sell)/0.15)] border border-[hsl(var(--signal-sell)/0.2)] rounded-md text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--signal-sell))] transition-all"
          >
            <Trash2 size={10} />
            Clear All
          </button>
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
              <th className="px-4 py-3 font-medium w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--engine-border))]">
            {trades.map((t) => (
              <TradeRow key={t.id} t={t} onDelete={onDeleteTrade} deleting={deletingIds.has(t.id)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Trade Row ───────────────────────────────────────────────

function TradeRow({ t, onDelete, deleting }: { t: any; onDelete: (id: number) => void; deleting: boolean }) {
  const isWin = t.result === "WIN";
  const isPending = t.result === "PENDING";
  return (
    <tr className="hover:bg-[hsl(var(--engine-surface))] transition-colors group">
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
      <td className="px-4 py-3">
        <button
          onClick={() => onDelete(t.id)}
          disabled={deleting}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[hsl(var(--signal-sell)/0.15)] text-[hsl(var(--signal-sell)/0.6)] hover:text-[hsl(var(--signal-sell))] transition-all"
        >
          <Trash2 size={12} />
        </button>
      </td>
    </tr>
  );
}

// ─── Backtests Table ─────────────────────────────────────────

function BacktestsTable({ backtests, onDelete, deletingIds }: { backtests: any[]; onDelete: (id: string) => void; deletingIds: Set<number | string> }) {
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
                <div className="flex items-start gap-3">
                  <div className="text-right">
                    <div className={`text-2xl font-black font-mono ${isProfitable ? "text-[hsl(var(--signal-buy))]" : "text-[hsl(var(--signal-sell))]"}`}>
                      {isProfitable ? "+" : ""}${netProfit.toFixed(2)}
                    </div>
                    <span className={`text-[9px] font-bold ${isProfitable ? "text-[hsl(var(--signal-buy))]" : "text-[hsl(var(--signal-sell))]"}`}>
                      {isProfitable ? "PROFITABLE" : "LOSS"}
                    </span>
                  </div>
                  <button
                    onClick={() => onDelete(bt.id)}
                    disabled={deletingIds.has(bt.id)}
                    className="p-2 rounded-md hover:bg-[hsl(var(--signal-sell)/0.1)] text-[hsl(var(--engine-text-dim))] hover:text-[hsl(var(--signal-sell))] transition-all"
                  >
                    <Trash2 size={14} />
                  </button>
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
