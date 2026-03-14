import { ShieldCheck } from "lucide-react";
import type { ConnectionStatus } from "@/services/derivWebSocket";

interface SystemHealthProps {
  wsStatus: ConnectionStatus;
}

export function SystemHealth({ wsStatus }: SystemHealthProps) {
  return (
    <div className="p-6 engine-panel rounded-lg">
      <h3 className="engine-section-title mb-4">
        <ShieldCheck size={14} /> Engine Status
      </h3>
      <div className="space-y-4">
        <StatusRow
          label="Deriv WebSocket"
          value={wsStatus === "connected" ? "CONNECTED" : wsStatus === "connecting" ? "CONNECTING" : "OFFLINE"}
          status={wsStatus === "connected" ? "healthy" : wsStatus === "connecting" ? "warning" : "error"}
        />
        <StatusRow label="SMC Logic" value="EMA 9/21 + RSI" status="healthy" />
        <StatusRow label="Database" value="CLOUD ACTIVE" status="healthy" />
        <StatusRow label="Realtime" value="STREAMING" status="healthy" />
        <div className="pt-2 border-t border-engine-border">
          <p className="text-[10px] text-engine-text-dim leading-relaxed italic font-mono">
            "Strategy uses EMA 9/21 cross + RSI momentum on real Deriv tick data."
          </p>
        </div>
      </div>
    </div>
  );
}

function StatusRow({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status: "healthy" | "error" | "warning";
}) {
  const colorMap = {
    healthy: "text-signal-buy",
    error: "text-signal-sell",
    warning: "text-warning",
  };
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-engine-text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <div className={`status-dot-${status}`} />
        <span className={`text-[11px] font-bold font-mono ${colorMap[status]}`}>{value}</span>
      </div>
    </div>
  );
}
