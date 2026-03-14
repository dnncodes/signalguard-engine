import { useState, useEffect } from "react";
import { Zap, RefreshCw } from "lucide-react";

interface LiveAutomationPanelProps {
  isRunning: boolean;
  accountType: "demo" | "live";
  onAccountTypeChange: (type: "demo" | "live") => void;
  balance: number | null;
  currency: string;
  balanceLoading: boolean;
  errors: Record<string, string>;
  onStart: (params: {
    duration: number;
    profitTarget: number;
    initialTradeAmount: number;
    martingaleMultiplier: number;
    maxMartingaleLevel: number;
  }) => void;
  onStop: () => void;
  onValidate: (params: {
    duration: number;
    profitTarget: number;
    initialTradeAmount: number;
    martingaleMultiplier: number;
    maxMartingaleLevel: number;
  }) => Record<string, string>;
  onErrorsChange: (errors: Record<string, string>) => void;
}

export function LiveAutomationPanel({
  isRunning,
  accountType,
  onAccountTypeChange,
  balance,
  currency,
  balanceLoading,
  errors,
  onStart,
  onStop,
  onValidate,
  onErrorsChange,
}: LiveAutomationPanelProps) {
  const [duration, setDuration] = useState(1);
  const [profitTarget, setProfitTarget] = useState(50);
  const [initialTradeAmount, setInitialTradeAmount] = useState(10);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState(2.2);
  const [maxMartingaleLevel, setMaxMartingaleLevel] = useState(5);

  const params = { duration, profitTarget, initialTradeAmount, martingaleMultiplier, maxMartingaleLevel };

  useEffect(() => {
    onErrorsChange(onValidate(params));
  }, [duration, profitTarget, initialTradeAmount, martingaleMultiplier, maxMartingaleLevel]);

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <section className="p-6 engine-panel rounded-lg shadow-2xl">
      <div className="flex items-center justify-between mb-6">
        <h3 className="engine-section-title">
          <Zap size={14} /> Live Automation
        </h3>
        {isRunning && <RefreshCw size={14} className="animate-spin text-signal-buy" />}
      </div>

      <div className="space-y-5">
        <div className="flex items-center gap-4">
          <label className="engine-label">Account</label>
          <select
            value={accountType}
            onChange={(e) => onAccountTypeChange(e.target.value as "demo" | "live")}
            className="engine-input"
          >
            <option value="demo">Demo</option>
            <option value="live">Live</option>
          </select>
          {balanceLoading ? (
            <span className="ml-auto text-[10px] font-mono text-engine-text-muted">Loading...</span>
          ) : balance !== null ? (
            <span className="ml-auto text-[10px] font-mono text-engine-text-secondary">
              Balance: {currency} ${balance.toFixed(2)}
            </span>
          ) : (
            <span className="ml-auto text-[10px] font-mono text-destructive">--</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FieldInput label="Duration (Hours)" value={duration} onChange={setDuration} min={1} error={errors.duration} />
          <FieldInput label="Profit Target ($)" value={profitTarget} onChange={setProfitTarget} step={0.01} min={0} error={errors.profitTarget} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FieldInput label="Initial Trade Amount ($)" value={initialTradeAmount} onChange={setInitialTradeAmount} step={0.01} min={0.1} error={errors.initialTradeAmount} />
          <FieldInput label="Martingale Multiplier" value={martingaleMultiplier} onChange={setMartingaleMultiplier} step={0.1} min={1.1} max={5} error={errors.martingaleMultiplier} />
        </div>

        <FieldInput label="Max Martingale Level" value={maxMartingaleLevel} onChange={setMaxMartingaleLevel} min={1} max={10} error={errors.maxMartingaleLevel} />

        <div className="flex gap-2">
          <button
            onClick={() => onStart(params)}
            disabled={isRunning || hasErrors}
            className={`flex-1 py-3 rounded-md font-bold transition-all text-xs uppercase tracking-widest flex items-center justify-center gap-2 ${
              isRunning || hasErrors
                ? "bg-engine-surface text-engine-text-dim cursor-not-allowed"
                : "bg-signal-buy text-engine-bg hover:opacity-90 shadow-lg shadow-signal-buy/20 active:scale-[0.98]"
            }`}
          >
            {isRunning ? "Running..." : "Start Automation"}
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

function FieldInput({
  label,
  value,
  onChange,
  step,
  min,
  max,
  error,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  error?: string;
}) {
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
