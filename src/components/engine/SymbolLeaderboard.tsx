import { useState, useEffect, useCallback } from "react";
import { Trophy, RefreshCw, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SYMBOLS } from "@/types/engine";

interface SymbolPerformance {
  symbol: string;
  name: string;
  totalTrades: number;
  wins: number;
  losses: number;
  pending: number;
  winRate: number;
  totalProfit: number;
  avgProfit: number;
  streak: number; // positive = win streak, negative = loss streak
}

export function SymbolLeaderboard() {
  const [data, setData] = useState<SymbolPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<"all" | "automation" | "test">("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("trade_logs")
        .select("symbol, result, profit, source, created_at")
        .order("created_at", { ascending: false })
        .limit(1000);

      if (source !== "all") {
        query = query.eq("source", source);
      }

      const { data: trades, error } = await query;
      if (error) throw error;

      // Aggregate per symbol
      const map = new Map<string, { wins: number; losses: number; pending: number; profit: number; results: string[] }>();

      // Initialize all 20 symbols
      for (const sym of Object.keys(SYMBOLS)) {
        map.set(sym, { wins: 0, losses: 0, pending: 0, profit: 0, results: [] });
      }

      for (const t of trades || []) {
        const entry = map.get(t.symbol);
        if (!entry) continue;
        if (t.result === "WIN") entry.wins++;
        else if (t.result === "LOSS") entry.losses++;
        else entry.pending++;
        entry.profit += Number(t.profit || 0);
        entry.results.push(t.result || "PENDING");
      }

      const performances: SymbolPerformance[] = [];
      for (const [symbol, stats] of map) {
        const total = stats.wins + stats.losses;
        
        // Calculate current streak
        let streak = 0;
        for (const r of stats.results) {
          if (r === "PENDING") continue;
          if (streak === 0) {
            streak = r === "WIN" ? 1 : -1;
          } else if ((streak > 0 && r === "WIN") || (streak < 0 && r === "LOSS")) {
            streak += streak > 0 ? 1 : -1;
          } else {
            break;
          }
        }

        performances.push({
          symbol,
          name: SYMBOLS[symbol] || symbol,
          totalTrades: total + stats.pending,
          wins: stats.wins,
          losses: stats.losses,
          pending: stats.pending,
          winRate: total > 0 ? (stats.wins / total) * 100 : 0,
          totalProfit: stats.profit,
          avgProfit: total > 0 ? stats.profit / total : 0,
          streak,
        });
      }

      // Sort by win rate (with trades), then by total trades
      performances.sort((a, b) => {
        const aHasTrades = a.wins + a.losses > 0;
        const bHasTrades = b.wins + b.losses > 0;
        if (aHasTrades && !bHasTrades) return -1;
        if (!aHasTrades && bHasTrades) return 1;
        if (a.winRate !== b.winRate) return b.winRate - a.winRate;
        return b.totalTrades - a.totalTrades;
      });

      setData(performances);
    } catch (err) {
      console.error("[Leaderboard] Load failed:", err);
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => { load(); }, [load]);

  const getMedalEmoji = (rank: number) => {
    if (rank === 0) return "🥇";
    if (rank === 1) return "🥈";
    if (rank === 2) return "🥉";
    return null;
  };

  const getWinRateColor = (rate: number, hasTrades: boolean) => {
    if (!hasTrades) return "text-engine-text-dim";
    if (rate >= 65) return "text-signal-buy";
    if (rate >= 50) return "text-engine-text-primary";
    return "text-signal-sell";
  };

  return (
    <section className="engine-panel rounded-lg overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-engine-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 bg-[hsl(45,100%,50%,0.1)] rounded-md flex items-center justify-center">
              <Trophy size={16} className="text-[hsl(45,100%,50%)]" />
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest">Symbol Leaderboard</h3>
              <p className="text-[9px] text-engine-text-dim font-mono mt-0.5">
                Performance ranking across all 20 markets
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Source filter */}
            <div className="flex gap-0.5 p-0.5 bg-engine-bg rounded-md border border-engine-border">
              {(["all", "automation", "test"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSource(s)}
                  className={`px-2.5 py-1 rounded-sm text-[8px] font-bold uppercase tracking-widest transition-all ${
                    source === s
                      ? "bg-signal-buy text-engine-bg"
                      : "text-engine-text-dim hover:text-engine-text-secondary"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <button
              onClick={load}
              disabled={loading}
              className="p-1.5 hover:bg-engine-surface-hover rounded-md transition-all"
            >
              <RefreshCw size={12} className={`text-engine-text-muted ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
        <table className="w-full text-left text-[10px] font-mono">
          <thead className="sticky top-0 bg-engine-bg/95 backdrop-blur-sm z-10">
            <tr className="text-engine-text-dim border-b border-engine-border uppercase tracking-tighter">
              <th className="px-4 py-2.5 font-medium w-8">#</th>
              <th className="px-4 py-2.5 font-medium">Symbol</th>
              <th className="px-4 py-2.5 font-medium text-center">Win Rate</th>
              <th className="px-4 py-2.5 font-medium text-center">W / L</th>
              <th className="px-4 py-2.5 font-medium text-center">Trades</th>
              <th className="px-4 py-2.5 font-medium text-right">P&L</th>
              <th className="px-4 py-2.5 font-medium text-center">Streak</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-engine-border">
            {data.map((sym, i) => {
              const hasTrades = sym.wins + sym.losses > 0;
              const medal = getMedalEmoji(i);
              return (
                <tr
                  key={sym.symbol}
                  className={`hover:bg-engine-surface transition-colors ${
                    i < 3 && hasTrades ? "bg-engine-surface/30" : ""
                  }`}
                >
                  <td className="px-4 py-2.5 text-engine-text-muted">
                    {medal ? <span className="text-sm">{medal}</span> : <span>{i + 1}</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <div>
                      <p className="text-engine-text-secondary font-bold text-[11px]">{sym.symbol}</p>
                      <p className="text-[8px] text-engine-text-dim truncate max-w-[140px]">{sym.name}</p>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className={`text-sm font-black ${getWinRateColor(sym.winRate, hasTrades)}`}>
                        {hasTrades ? `${sym.winRate.toFixed(1)}%` : "—"}
                      </span>
                      {hasTrades && (
                        <div className="w-16 h-1 bg-engine-bg rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              sym.winRate >= 50 ? "bg-signal-buy" : "bg-signal-sell"
                            }`}
                            style={{ width: `${Math.min(sym.winRate, 100)}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className="text-signal-buy font-bold">{sym.wins}</span>
                    <span className="text-engine-text-dim"> / </span>
                    <span className="text-signal-sell font-bold">{sym.losses}</span>
                  </td>
                  <td className="px-4 py-2.5 text-center text-engine-text-secondary font-bold">
                    {sym.totalTrades}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={`font-bold ${
                      sym.totalProfit > 0 ? "text-signal-buy" : sym.totalProfit < 0 ? "text-signal-sell" : "text-engine-text-muted"
                    }`}>
                      {sym.totalProfit !== 0 ? `${sym.totalProfit > 0 ? "+" : ""}$${sym.totalProfit.toFixed(2)}` : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {sym.streak !== 0 ? (
                      <span className={`flex items-center justify-center gap-0.5 ${
                        sym.streak > 0 ? "text-signal-buy" : "text-signal-sell"
                      }`}>
                        {sym.streak > 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                        <span className="font-bold">{Math.abs(sym.streak)}</span>
                      </span>
                    ) : (
                      <Minus size={10} className="mx-auto text-engine-text-dim" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer summary */}
      {data.length > 0 && (() => {
        const withTrades = data.filter(d => d.wins + d.losses > 0);
        const avgWinRate = withTrades.length > 0 ? withTrades.reduce((s, d) => s + d.winRate, 0) / withTrades.length : 0;
        const totalPL = data.reduce((s, d) => s + d.totalProfit, 0);
        return (
          <div className="px-5 py-3 border-t border-engine-border bg-engine-bg/50 flex items-center justify-between text-[9px] font-mono text-engine-text-dim">
            <span>{withTrades.length} symbols traded</span>
            <span>Avg Win Rate: <b className="text-engine-text-secondary">{avgWinRate.toFixed(1)}%</b></span>
            <span>Total P&L: <b className={totalPL >= 0 ? "text-signal-buy" : "text-signal-sell"}>${totalPL.toFixed(2)}</b></span>
          </div>
        );
      })()}
    </section>
  );
}
