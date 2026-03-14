import { ShieldCheck } from "lucide-react";
import type { ConnectionStatus } from "@/services/derivWebSocket";

interface SystemHealthProps {
  wsStatus: ConnectionStatus;
}

export function SystemHealth({ wsStatus }: SystemHealthProps) {
  return (
    <div className="p-4 engine-panel rounded-lg">
      <h3 className="engine-section-title mb-3">
        <ShieldCheck size={14} /> Engine Status
      </h3>
      <div className="space-y-2">
        <StatusRow
          label="WebSocket"
          value={wsStatus === "connected" ? "LIVE" : wsStatus === "connecting" ? "..." : "OFF"}
          status={wsStatus === "connected" ? "healthy" : wsStatus === "connecting" ? "warning" : "error"}
        />
        <StatusRow label="Signal Engine" value="EMA+RSI+MACD+ATR" status="healthy" />
        <StatusRow label="Database" value="ACTIVE" status="healthy" />
        <StatusRow label="Telegram" value="ACTIVE" status="healthy" />
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
      <span className="text-[10px] text-engine-text-muted">{label}</span>
      <div className="flex items-center gap-1.5">
        <div className={`status-dot-${status}`} />
        <span className={`text-[10px] font-bold font-mono ${colorMap[status]}`}>{value}</span>
      </div>
    </div>
  );
}