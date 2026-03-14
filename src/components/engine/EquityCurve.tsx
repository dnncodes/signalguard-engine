import { useMemo } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { TrendingUp } from "lucide-react";
import type { LiveAutomationStatus } from "@/types/engine";

interface EquityCurveProps {
  status: LiveAutomationStatus | null;
}

export function EquityCurve({ status }: EquityCurveProps) {
  const data = useMemo(() => {
    if (!status?.trades?.length) return [];

    const points: { time: string; balance: number; trade: number }[] = [];

    // Add initial balance point if we have currentBalance info
    const settledTrades = status.trades.filter(t => t.status === "SETTLED" && t.profit != null);
    
    if (settledTrades.length === 0 && status.trades.length > 0) {
      // Only pending trades — show starting balance
      if (status.currentBalance != null) {
        points.push({
          time: "Start",
          balance: status.currentBalance,
          trade: 0,
        });
      }
      return points;
    }

    // Reconstruct balance curve from settled trades
    // Work backwards from currentBalance to find starting balance
    const totalSettledProfit = settledTrades.reduce((sum, t) => sum + (t.profit || 0), 0);
    const startingBalance = status.currentBalance != null
      ? status.currentBalance - totalSettledProfit
      : 10000; // fallback

    let runningBalance = startingBalance;
    points.push({ time: "Start", balance: runningBalance, trade: 0 });

    status.trades.forEach((t, i) => {
      if (t.status === "SETTLED" && t.profit != null) {
        runningBalance += t.profit;
        points.push({
          time: new Date(t.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          balance: Math.round(runningBalance * 100) / 100,
          trade: i + 1,
        });
      }
    });

    return points;
  }, [status]);

  if (!status || data.length < 2) return null;

  const initialBalance = data[0]?.balance ?? 0;
  const currentBalance = data[data.length - 1]?.balance ?? 0;
  const isProfit = currentBalance >= initialBalance;
  const minBalance = Math.min(...data.map(d => d.balance));
  const maxBalance = Math.max(...data.map(d => d.balance));
  const padding = (maxBalance - minBalance) * 0.1 || 10;

  return (
    <div className="p-5 engine-panel rounded-lg">
      <div className="flex items-center justify-between mb-4">
        <h4 className="flex items-center gap-2 text-sm font-bold text-engine-text-secondary uppercase tracking-widest">
          <TrendingUp size={14} className={isProfit ? "text-signal-buy" : "text-signal-sell"} />
          Equity Curve
        </h4>
        <div className="flex items-center gap-3 text-[9px] font-mono">
          <span className="text-engine-text-dim">
            Start: <b className="text-engine-text-primary">${initialBalance.toFixed(2)}</b>
          </span>
          <span className="text-engine-text-dim">
            Now: <b className={isProfit ? "text-signal-buy" : "text-signal-sell"}>${currentBalance.toFixed(2)}</b>
          </span>
          <span className={`font-bold ${isProfit ? "text-signal-buy" : "text-signal-sell"}`}>
            {isProfit ? "+" : ""}${(currentBalance - initialBalance).toFixed(2)}
          </span>
        </div>
      </div>

      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={isProfit ? "hsl(142, 76%, 46%)" : "hsl(0, 84%, 60%)"} stopOpacity={0.3} />
                <stop offset="100%" stopColor={isProfit ? "hsl(142, 76%, 46%)" : "hsl(0, 84%, 60%)"} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="time"
              tick={{ fontSize: 8, fill: "hsl(0, 0%, 45%)" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              domain={[minBalance - padding, maxBalance + padding]}
              tick={{ fontSize: 8, fill: "hsl(0, 0%, 45%)" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `$${v.toFixed(0)}`}
              width={50}
            />
            <ReferenceLine
              y={initialBalance}
              stroke="hsl(0, 0%, 30%)"
              strokeDasharray="4 4"
              strokeWidth={1}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(220, 20%, 10%)",
                border: "1px solid hsl(220, 10%, 20%)",
                borderRadius: "6px",
                fontSize: "10px",
                fontFamily: "monospace",
              }}
              labelStyle={{ color: "hsl(0, 0%, 60%)" }}
              formatter={(value: number) => [`$${value.toFixed(2)}`, "Balance"]}
            />
            <Area
              type="monotone"
              dataKey="balance"
              stroke={isProfit ? "hsl(142, 76%, 46%)" : "hsl(0, 84%, 60%)"}
              strokeWidth={2}
              fill="url(#equityGradient)"
              dot={{ r: 3, fill: isProfit ? "hsl(142, 76%, 46%)" : "hsl(0, 84%, 60%)", strokeWidth: 0 }}
              activeDot={{ r: 5, strokeWidth: 2, stroke: "hsl(0, 0%, 100%)" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
