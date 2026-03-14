/**
 * Deriv WebSocket Client
 * 
 * Connects directly to Deriv's public WebSocket API for real-time market data.
 * No authentication needed for ticks/prices — keeps the API token server-side only.
 */

const DERIV_WS_URL = "wss://ws.derivws.com/websockets/v3?app_id=1089";

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

export interface TickData {
  symbol: string;
  quote: number;
  epoch: number;
  pipSize: number;
}

type TickHandler = (tick: TickData) => void;
type StatusHandler = (status: ConnectionStatus) => void;
type ErrorHandler = (error: string) => void;

class DerivWebSocketClient {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = "disconnected";
  private subscriptions = new Map<string, string>(); // symbol -> subscription_id
  private tickHandlers: TickHandler[] = [];
  private statusHandlers: StatusHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pendingRequests = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
  private reqIdCounter = 1;

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.setStatus("connecting");
    this.ws = new WebSocket(DERIV_WS_URL);

    this.ws.onopen = () => {
      this.setStatus("connected");
      this.reconnectAttempts = 0;
      this.startHeartbeat();

      // Re-subscribe to all previous symbols
      for (const symbol of this.subscriptions.keys()) {
        this.subscribeTicks(symbol);
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Handle pending request responses
        if (data.req_id && this.pendingRequests.has(data.req_id)) {
          const pending = this.pendingRequests.get(data.req_id)!;
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(data.req_id);

          if (data.error) {
            pending.reject(new Error(`${data.error.message} (${data.error.code})`));
          } else {
            pending.resolve(data);
          }
          return;
        }

        // Handle tick stream
        if (data.msg_type === "tick" && data.tick) {
          const tick: TickData = {
            symbol: data.tick.symbol,
            quote: data.tick.quote,
            epoch: data.tick.epoch,
            pipSize: data.tick.pip_size,
          };
          this.tickHandlers.forEach((h) => h(tick));
        }

        // Track subscription IDs
        if (data.subscription) {
          const symbol = data.echo_req?.ticks;
          if (symbol) {
            this.subscriptions.set(symbol, data.subscription.id);
          }
        }

        // Handle errors
        if (data.error) {
          this.errorHandlers.forEach((h) =>
            h(`${data.error.message} (${data.error.code})`)
          );
        }
      } catch (e) {
        console.error("[DerivWS] Parse error:", e);
      }
    };

    this.ws.onclose = (event) => {
      this.stopHeartbeat();
      this.setStatus("disconnected");

      if (!event.wasClean && this.reconnectAttempts < this.maxReconnectAttempts) {
        const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
        this.reconnectAttempts++;
        console.log(`[DerivWS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
        this.reconnectTimer = setTimeout(() => this.connect(), delay);
      }
    };

    this.ws.onerror = () => {
      this.setStatus("error");
      this.errorHandlers.forEach((h) => h("WebSocket connection error"));
    };
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.reconnectAttempts = this.maxReconnectAttempts; // prevent reconnect
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscriptions.clear();
    this.setStatus("disconnected");
  }

  private send(msg: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not connected"));
        return;
      }

      const reqId = this.reqIdCounter++;
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new Error("Request timed out"));
      }, 15000);

      this.pendingRequests.set(reqId, { resolve, reject, timeout });
      this.ws.send(JSON.stringify({ ...msg, req_id: reqId }));
    });
  }

  async subscribeTicks(symbol: string) {
    try {
      await this.send({ ticks: symbol, subscribe: 1 });
    } catch (e) {
      console.error(`[DerivWS] Failed to subscribe to ${symbol}:`, e);
    }
  }

  async unsubscribeTicks(symbol: string) {
    const subId = this.subscriptions.get(symbol);
    if (subId) {
      try {
        await this.send({ forget: subId });
        this.subscriptions.delete(symbol);
      } catch (e) {
        console.error(`[DerivWS] Failed to unsubscribe from ${symbol}:`, e);
      }
    }
  }

  async getTickHistory(symbol: string, count = 100) {
    const res = await this.send({
      ticks_history: symbol,
      adjust_start_time: 1,
      count,
      end: "latest",
      start: 1,
      style: "ticks",
    });
    return res.history;
  }

  async getActiveSymbols() {
    const res = await this.send({
      active_symbols: "brief",
      product_type: "basic",
    });
    return (res.active_symbols || []).filter(
      (s: any) => s.market === "synthetic_index"
    );
  }

  onTick(handler: TickHandler) {
    this.tickHandlers.push(handler);
    return () => {
      this.tickHandlers = this.tickHandlers.filter((h) => h !== handler);
    };
  }

  onStatusChange(handler: StatusHandler) {
    this.statusHandlers.push(handler);
    return () => {
      this.statusHandlers = this.statusHandlers.filter((h) => h !== handler);
    };
  }

  onError(handler: ErrorHandler) {
    this.errorHandlers.push(handler);
    return () => {
      this.errorHandlers = this.errorHandlers.filter((h) => h !== handler);
    };
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getSubscribedSymbols(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  private setStatus(status: ConnectionStatus) {
    this.status = status;
    this.statusHandlers.forEach((h) => h(status));
  }

  private startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ ping: 1 }));
      }
    }, 30000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

// Singleton instance
export const derivWs = new DerivWebSocketClient();
