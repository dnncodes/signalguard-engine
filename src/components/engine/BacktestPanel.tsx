import { useState, useEffect } from "react";
import { History, RefreshCw } from "lucide-react";
import type { MarketStatus } from "@/types/engine";
import type { BacktestConfig } from "@/hooks/useEngine";

interface BacktestPanelProps {
  status: MarketStatus[];
  isRunning: boolean;
  errors: Record<string, string>;
  onRun: (config: BacktestConfig) => void;
  onStop: () => void;
  onValidate: (config: BacktestConfig) => Record<string, string>;
  onErrorsChange: (errors: Record<string, string>) => void;
}

export function BacktestPanel({
  status,
  isRunning,
  errors,
  onRun,
  onStop,
  onValidate,
  onErrorsChange,
}: BacktestPanelProps) {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [duration, setDuration] = useState(1);
  const [timeframe, setTimeframe] = useState(5);
  const [initialTradeAmount, setInitialTradeAmount] = useState(10);
  const [initialBalance, setInitialBalance] = useState(500);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState(2.2);
  const [maxMartingaleLevel, setMaxMartingaleLevel] = useState(5);
  const [profitTarget, setProfitTarget] = useState(0);

  const config: BacktestConfig = {
    symbols,
    duration,
    timeframe,
    initialTradeAmount,
    initialBalance,
    martingaleMultiplier,
    maxMartingaleLevel,
    profitTarget,
  };

  useEffect(() => {
    onErrorsChange(onValidate(config));
  }, [duration, initialTradeAmount, initialBalance, martingaleMultiplier, maxMartingaleLevel, profitTarget]);

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <section className="p-6 engine-panel rounded-lg shadow-2xl">
      <div className="flex items-center justify-between mb-6">
        <h3 className="engine-section-title">
          <History size={14} /> Backtest Engine
        </h3>
        {isRunning && <RefreshCw size={14} className="animate-spin text-signal-buy" />}
      </div>

      <div className="space-y-5">
        {/* Asset Selection */}
        <div className="space-y-1.5">
          <label className="engine-label">Asset Selection (Multi)</label>
          {errors.symbols && <p className="text-destructive text-[8px] font-mono">{errors.symbols}</p>}
          <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto p-2 bg-engine-bg rounded-md border border-engine-border-hover scrollbar-thin scrollbar-thumb-engine-text-dim">
            {(status.length > 0
              ? status.map((s) => ({ key: s.symbol, name: s.name }))
              : Object.entries(SYMBOLS).map(([key, name]) => ({ key, name }))
            ).map((s) => (
              <label
                key={s.key}
                className="flex items-center gap-2 p-2 hover:bg-engine-surface-hover rounded-md cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={symbols.includes(s.key)}
                  onChange={(e) => {
                    setSymbols(
                      e.target.checked
                        ? [...symbols, s.key]
                        : symbols.filter((sym) => sym !== s.key)
                    );
                  }}
                  className="w-3 h-3 accent-signal-buy"
                />
                <span className="text-[10px] font-medium truncate text-engine-text-secondary">
                  {s.name}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Duration & Timeframe */}
        <div className="grid grid-cols-2 gap-4">
          <FieldInput label="Duration (Hours)" value={duration} onChange={setDuration} min={1} max={168} error={errors.duration} />
          <FieldInput label="Timeframe (Minutes)" value={timeframe} onChange={setTimeframe} min={1} max={60} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FieldInput label="Initial Trade Amount ($)" value={initialTradeAmount} onChange={setInitialTradeAmount} step={0.01} min={0.1} error={errors.initialTradeAmount} />
          <FieldInput label="Account Balance ($)" value={initialBalance} onChange={setInitialBalance} step={0.01} min={1} error={errors.initialBalance} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FieldInput label="Martingale Multiplier" value={martingaleMultiplier} onChange={setMartingaleMultiplier} step={0.1} min={1.1} max={5} error={errors.martingaleMultiplier} />
          <FieldInput label="Max Martingale Level" value={maxMartingaleLevel} onChange={setMaxMartingaleLevel} min={1} max={10} error={errors.maxMartingaleLevel} />
        </div>

        <FieldInput label="Profit Target ($) - Optional" value={profitTarget} onChange={setProfitTarget} step={0.01} min={0} error={errors.profitTarget} />

        <div className="flex gap-2">
          <button
            onClick={() => onRun(config)}
            disabled={isRunning || hasErrors}
            className={`flex-1 py-3 rounded-md font-bold transition-all text-xs uppercase tracking-widest flex items-center justify-center gap-2 ${
              isRunning || hasErrors
                ? "bg-engine-surface text-engine-text-dim cursor-not-allowed"
                : "bg-signal-buy text-engine-bg hover:opacity-90 shadow-lg shadow-signal-buy/20 active:scale-[0.98]"
            }`}
          >
            {isRunning ? "Scanning..." : "Execute Simulation"}
          </button>
          {isRunning && (
            <button
              onClick={onStop}
              className="flex-none py-3 px-4 rounded-md bg-signal-sell text-engine-bg hover:opacity-90 shadow-lg shadow-signal-sell/20 active:scale-[0.98] text-xs uppercase tracking-widest font-bold"
            >
              Stop
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── Reusable field ──────────────────────────────────────────

interface FieldInputProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  error?: string;
}

function FieldInput({ label, value, onChange, step, min, max, error }: FieldInputProps) {
  return (
    <div className="space-y-1.5">
      <label className="engine-label">{label}</label>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        min={min}
        max={max}
        className="w-full engine-input"
      />
      {error && <p className="text-destructive text-[8px] mt-1 font-mono">{error}</p>}
    </div>
  );
}
