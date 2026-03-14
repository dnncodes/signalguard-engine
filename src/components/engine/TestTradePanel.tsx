import { useState } from "react";
import { Target, RefreshCw } from "lucide-react";
import { SYMBOLS, type TestTradeResult } from "@/types/engine";

interface TestTradePanelProps {
  loading: boolean;
  result: TestTradeResult | null;
  onExecute: (params: {
    accountType: "demo" | "live";
    amount: number;
    symbol: string;
    durationMinutes: number;
  }) => void;
}

export function TestTradePanel({ loading, result, onExecute }: TestTradePanelProps) {
  const [accountType, setAccountType] = useState<"demo" | "live">("demo");
  const [amount, setAmount] = useState(1.0); // Deriv min is $0.35
  const [duration, setDuration] = useState(5);
  const [symbol, setSymbol] = useState("R_10");

  return (
    <section className="p-6 engine-panel rounded-lg shadow-2xl">
      <div className="flex items-center justify-between mb-6">
        <h3 className="engine-section-title">
          <Target size={14} /> Test Trade
        </h3>
        {loading && <RefreshCw size={14} className="animate-spin text-signal-buy" />}
      </div>

      <div className="space-y-5">
        <div className="flex items-center gap-4">
          <label className="engine-label">Account</label>
          <select value={accountType} onChange={(e) => setAccountType(e.target.value as "demo" | "live")} className="engine-input">
            <option value="demo">Demo</option>
            <option value="live">Live</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="engine-label">Amount ($)</label>
            <input type="number" step={0.01} value={amount} onChange={(e) => setAmount(parseFloat(e.target.value) || 0)} min={0.1} className="w-full engine-input" />
          </div>
          <div className="space-y-1.5">
            <label className="engine-label">Duration (Minutes)</label>
            <input type="number" value={duration} onChange={(e) => setDuration(parseInt(e.target.value) || 1)} min={1} className="w-full engine-input" />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="engine-label">Symbol</label>
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="w-full engine-input">
            {Object.entries(SYMBOLS).map(([key, name]) => (
              <option key={key} value={key}>{name}</option>
            ))}
          </select>
        </div>

        <button
          onClick={() => onExecute({ accountType, amount, symbol, durationMinutes: duration })}
          disabled={loading}
          className={`w-full py-3 rounded-md font-bold transition-all text-xs uppercase tracking-widest flex items-center justify-center gap-2 ${
            loading
              ? "bg-engine-surface text-engine-text-dim cursor-not-allowed"
              : "bg-blue-500 text-engine-bg hover:bg-blue-400 shadow-lg shadow-blue-500/20 active:scale-[0.98]"
          }`}
        >
          {loading ? "Executing..." : "Execute Test Trade"}
        </button>

        {result && (
          <div className={`p-4 rounded-md border ${
            result.result === "WIN"
              ? "bg-signal-buy-bg border-signal-buy/20"
              : "bg-signal-sell-bg border-signal-sell/20"
          }`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-widest text-engine-text-secondary">Result</span>
              <span className={`text-xs font-bold font-mono ${result.result === "WIN" ? "text-signal-buy" : "text-signal-sell"}`}>
                {result.result}
              </span>
            </div>
            <div className="space-y-1 text-[10px] text-engine-text-secondary font-mono">
              <Row label="Symbol" value={SYMBOLS[result.symbol] || result.symbol} />
              <Row label="Type" value={result.type} />
              <Row label="Amount" value={`${result.currency} $${result.amount.toFixed(2)}`} />
              <Row label="Duration" value={`${result.durationMinutes} min`} />
              <Row
                label="Profit"
                value={`${result.currency} $${result.profit.toFixed(2)}`}
                className={result.profit >= 0 ? "text-signal-buy" : "text-signal-sell"}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Row({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-engine-text-muted">{label}:</span>
      <span className={className}>{value}</span>
    </div>
  );
}
