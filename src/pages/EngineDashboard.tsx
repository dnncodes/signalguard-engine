import { Link } from "react-router-dom";
import { Layers, History } from "lucide-react";
import { Header } from "@/components/engine/Header";
import { MarketTicker } from "@/components/engine/MarketTicker";
import { BacktestPanel } from "@/components/engine/BacktestPanel";
import { LiveAutomationPanel } from "@/components/engine/LiveAutomationPanel";
import { TestTradePanel } from "@/components/engine/TestTradePanel";
import { SystemHealth } from "@/components/engine/SystemHealth";
import { SignalFeed } from "@/components/engine/SignalFeed";
import { BacktestResults } from "@/components/engine/BacktestResults";
import { LiveResults } from "@/components/engine/LiveResults";
import { EngineFooter } from "@/components/engine/EngineFooter";
import { SymbolLeaderboard } from "@/components/engine/SymbolLeaderboard";
import {
  useSignals,
  useBacktest,
  useLiveAutomation,
  useTestTrade,
} from "@/hooks/useEngine";

export default function EngineDashboard() {
  const { signals, status, loading, error: dataError, wsStatus } = useSignals();
  const backtest = useBacktest();
  const live = useLiveAutomation();
  const testTrade = useTestTrade();

  return (
    <div className="min-h-screen bg-engine-bg text-engine-text-primary font-sans selection:bg-signal-buy/30">
      <Header marketCount={status.length} wsStatus={wsStatus} />
      <MarketTicker status={status} />

      <main className="max-w-[1600px] mx-auto px-6 py-8">
        {/* Connection error banner */}
        {dataError && (
          <div className="mb-6 p-4 rounded-md bg-signal-sell-bg border border-signal-sell/20 flex items-center gap-3">
            <div className="status-dot-error" />
            <p className="text-xs font-mono text-signal-sell">{dataError}</p>
          </div>
        )}

        {/* Nav to Trade History */}
        <div className="mb-6 flex justify-end">
          <Link
            to="/history"
            className="flex items-center gap-2 px-4 py-2 bg-engine-surface hover:bg-engine-surface-hover border border-engine-border rounded-md text-[10px] font-bold uppercase tracking-widest text-engine-text-muted hover:text-signal-buy transition-all"
          >
            <History size={14} />
            Trade History
          </Link>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
          {/* Sidebar */}
          <div className="xl:col-span-3 space-y-6">
            <BacktestPanel
              status={status}
              isRunning={backtest.isRunning}
              errors={backtest.errors}
              onRun={backtest.run}
              onStop={backtest.stop}
              onValidate={backtest.validate}
              onErrorsChange={backtest.setErrors}
            />
            <LiveAutomationPanel
              isRunning={live.isRunning}
              accountType={live.accountType}
              onAccountTypeChange={live.setAccountType}
              balance={live.balance}
              currency={live.currency}
              balanceLoading={live.balanceLoading}
              errors={live.errors}
              onStart={live.start}
              onStop={live.stop}
              onValidate={live.validate}
              onErrorsChange={live.setErrors}
            />
            <TestTradePanel
              loading={testTrade.loading}
              result={testTrade.result}
              onExecute={testTrade.execute}
            />
            <SystemHealth wsStatus={wsStatus} />
          </div>

          {/* Main content */}
          <div className="xl:col-span-9 space-y-8">
            <BacktestResults results={backtest.results} onClear={backtest.clear} />
            <LiveResults status={live.status} />

            {loading ? (
              <div className="h-64 flex flex-col items-center justify-center border border-dashed border-engine-border rounded-lg text-engine-text-dim">
                <Layers size={48} className="mb-4 opacity-10 animate-pulse" />
                <p className="text-xs uppercase tracking-widest font-bold font-mono">
                  Connecting to Deriv WebSocket...
                </p>
              </div>
            ) : (
              <SignalFeed signals={signals} />
            )}

            <SymbolLeaderboard />
          </div>
        </div>
      </main>

      <EngineFooter />
    </div>
  );
}
