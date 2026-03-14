import { Zap, AlertTriangle } from "lucide-react";

export function EngineFooter() {
  return (
    <footer className="border-t border-engine-border py-12 mt-20 bg-engine-bg/40">
      <div className="max-w-[1600px] mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 items-start">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Zap className="text-signal-buy" size={20} />
              <span className="font-bold tracking-tight text-engine-text-primary">DERIV SIGNAL PRO</span>
            </div>
            <p className="text-engine-text-dim text-xs leading-relaxed max-w-xs">
              Advanced algorithmic trading engine for Volatility Indices. Utilizing Smart Money Concepts and
              real-time technical analysis.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-3">
              <h4 className="text-[10px] font-bold text-engine-text-muted uppercase tracking-widest">Resources</h4>
              <ul className="space-y-2">
                <li>
                  <a href="#" className="text-xs text-engine-text-dim hover:text-engine-text-secondary transition-colors">
                    Documentation
                  </a>
                </li>
                <li>
                  <a href="#" className="text-xs text-engine-text-dim hover:text-engine-text-secondary transition-colors">
                    API Reference
                  </a>
                </li>
              </ul>
            </div>
            <div className="space-y-3">
              <h4 className="text-[10px] font-bold text-engine-text-muted uppercase tracking-widest">Community</h4>
              <ul className="space-y-2">
                <li>
                  <a href="#" className="text-xs text-engine-text-dim hover:text-engine-text-secondary transition-colors">
                    Telegram
                  </a>
                </li>
                <li>
                  <a href="#" className="text-xs text-engine-text-dim hover:text-engine-text-secondary transition-colors">
                    Discord
                  </a>
                </li>
              </ul>
            </div>
          </div>
          <div className="p-6 bg-signal-sell-bg border border-signal-sell/10 rounded-lg">
            <div className="flex items-center gap-2 text-signal-sell mb-2">
              <AlertTriangle size={14} />
              <span className="text-[10px] font-bold uppercase tracking-widest">Risk Warning</span>
            </div>
            <p className="text-[10px] text-engine-text-dim leading-relaxed">
              Trading involves significant risk. Past performance is not indicative of future results. Use this tool
              for educational purposes only.
            </p>
          </div>
        </div>
        <div className="mt-12 pt-8 border-t border-engine-border flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-engine-text-dim text-[10px]">© 2026 DNN ENGINE LABS. ALL RIGHTS RESERVED.</p>
          <div className="flex gap-6">
            <span className="text-[10px] text-engine-text-dim">PRIVACY POLICY</span>
            <span className="text-[10px] text-engine-text-dim">TERMS OF SERVICE</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
