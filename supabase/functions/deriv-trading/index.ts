import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DERIV_WS_URL = "wss://ws.derivws.com/websockets/v3?app_id=1089";

function derivRequest(ws: WebSocket, msg: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const reqId = Math.floor(Math.random() * 1e9);
    const payload = { ...msg, req_id: reqId };

    const timeout = setTimeout(() => {
      ws.removeEventListener("message", handler);
      reject(new Error("Deriv WS request timed out (15s)"));
    }, 15000);

    const handler = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.req_id === reqId) {
          ws.removeEventListener("message", handler);
          clearTimeout(timeout);
          if (data.error) {
            reject(new Error(`Deriv API: ${data.error.message} (${data.error.code})`));
          } else {
            resolve(data);
          }
        }
      } catch {
        // ignore non-matching messages
      }
    };

    ws.addEventListener("message", handler);
    ws.send(JSON.stringify(payload));
  });
}

function connectDeriv(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(DERIV_WS_URL);
    const timeout = setTimeout(() => {
      reject(new Error("Deriv WS connection timeout (10s)"));
    }, 10000);

    ws.onopen = () => {
      clearTimeout(timeout);
      resolve(ws);
    };
    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("Failed to connect to Deriv WebSocket"));
    };
  });
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 500) {
  console.error(`[deriv-trading] Error (${status}):`, message);
  return jsonResponse({ error: message }, status);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (!action) {
      return errorResponse("Missing 'action' query parameter. Use: balance, buy, sell, contract_status, ticks, active_symbols", 400);
    }

    const DERIV_TOKEN = Deno.env.get("DERIV_API_TOKEN");
    if (!DERIV_TOKEN) {
      return errorResponse("DERIV_API_TOKEN not configured", 500);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    let ws: WebSocket;
    try {
      ws = await connectDeriv();
    } catch (err) {
      return errorResponse(`WebSocket connection failed: ${err.message}`, 502);
    }

    try {
      // Authorize with Deriv
      const authRes = await derivRequest(ws, { authorize: DERIV_TOKEN });
      if (!authRes.authorize) {
        throw new Error("Deriv authorization failed - check API token");
      }

      const accountInfo = authRes.authorize;
      console.log(`[deriv-trading] Authorized: ${accountInfo.loginid} | Action: ${action}`);

      // ── BALANCE ──────────────────────────────────────────────
      if (action === "balance") {
        return jsonResponse({
          balance: accountInfo.balance,
          currency: accountInfo.currency,
          loginid: accountInfo.loginid,
        });
      }

      // ── BUY ──────────────────────────────────────────────────
      if (action === "buy" && req.method === "POST") {
        const body = await req.json();
        const { symbol, amount, contract_type, duration, duration_unit, source } = body;

        if (!symbol || !amount || !contract_type) {
          return errorResponse("Missing required fields: symbol, amount, contract_type", 400);
        }

        if (amount < 0.35) {
          return errorResponse("Minimum trade amount is $0.35", 400);
        }

        // Get proposal
        const proposalRes = await derivRequest(ws, {
          proposal: 1,
          amount: amount,
          basis: "stake",
          contract_type: contract_type,
          currency: accountInfo.currency,
          duration: duration || 5,
          duration_unit: duration_unit || "m",
          symbol: symbol,
        });

        if (!proposalRes.proposal) {
          throw new Error("Failed to get price proposal from Deriv");
        }

        console.log(`[deriv-trading] Proposal: ${proposalRes.proposal.id} | Ask: ${proposalRes.proposal.ask_price}`);

        // Buy the contract
        const buyRes = await derivRequest(ws, {
          buy: proposalRes.proposal.id,
          price: proposalRes.proposal.ask_price,
        });

        const buyData = buyRes.buy;
        console.log(`[deriv-trading] Bought contract ${buyData.contract_id} | Price: ${buyData.buy_price}`);

        // Log to database
        const { error: insertError } = await supabase.from("trade_logs").insert({
          symbol,
          trade_type: contract_type === "CALL" || contract_type === "HIGHER" ? "BUY" : "SELL",
          contract_type,
          amount: buyData.buy_price,
          entry_price: proposalRes.proposal.spot,
          contract_id: buyData.contract_id,
          transaction_id: buyData.transaction_id,
          balance_after: buyData.balance_after,
          duration_minutes: duration || 5,
          account_type: accountInfo.is_virtual ? "demo" : "live",
          currency: accountInfo.currency,
          source: source || "manual",
          result: "PENDING",
          metadata: {
            payout: buyData.payout,
            longcode: buyData.longcode,
            shortcode: buyData.shortcode,
            purchase_time: buyData.purchase_time,
            start_time: buyData.start_time,
          },
        });

        if (insertError) {
          console.error("[deriv-trading] Failed to log trade:", insertError.message);
        }

        return jsonResponse({
          success: true,
          contract_id: buyData.contract_id,
          buy_price: buyData.buy_price,
          payout: buyData.payout,
          balance_after: buyData.balance_after,
          longcode: buyData.longcode,
        });
      }

      // ── SELL ─────────────────────────────────────────────────
      if (action === "sell" && req.method === "POST") {
        const body = await req.json();
        const { contract_id, price } = body;

        if (!contract_id) {
          return errorResponse("Missing contract_id", 400);
        }

        const sellRes = await derivRequest(ws, {
          sell: contract_id,
          price: price || 0,
        });

        const sellData = sellRes.sell;

        // Update trade log
        const { error: updateError } = await supabase
          .from("trade_logs")
          .update({
            exit_price: sellData.sold_for,
            profit: sellData.sold_for - (price || 0),
            balance_after: sellData.balance_after,
            result: sellData.sold_for > 0 ? "WIN" : "LOSS",
          })
          .eq("contract_id", contract_id);

        if (updateError) {
          console.error("[deriv-trading] Failed to update trade log:", updateError.message);
        }

        return jsonResponse({
          success: true,
          sold_for: sellData.sold_for,
          balance_after: sellData.balance_after,
          contract_id: sellData.contract_id,
        });
      }

      // ── CONTRACT STATUS ──────────────────────────────────────
      if (action === "contract_status" && req.method === "POST") {
        const body = await req.json();
        const { contract_id } = body;

        if (!contract_id) {
          return errorResponse("Missing contract_id", 400);
        }

        const statusRes = await derivRequest(ws, {
          proposal_open_contract: 1,
          contract_id,
        });

        return jsonResponse(statusRes.proposal_open_contract || statusRes);
      }

      // ── TICK HISTORY ─────────────────────────────────────────
      if (action === "ticks") {
        const symbol = url.searchParams.get("symbol") || "R_100";
        const count = parseInt(url.searchParams.get("count") || "100");

        const histRes = await derivRequest(ws, {
          ticks_history: symbol,
          adjust_start_time: 1,
          count,
          end: "latest",
          start: 1,
          style: "ticks",
        });

        return jsonResponse(histRes.history || histRes);
      }

      // ── ACTIVE SYMBOLS ───────────────────────────────────────
      if (action === "active_symbols") {
        const symbolsRes = await derivRequest(ws, {
          active_symbols: "brief",
          product_type: "basic",
        });

        const synthetics = (symbolsRes.active_symbols || []).filter(
          (s: any) => s.market === "synthetic_index"
        );

        return jsonResponse(synthetics);
      }

      return errorResponse(
        "Unknown action. Use: balance, buy, sell, contract_status, ticks, active_symbols",
        400
      );
    } finally {
      try {
        ws.close();
      } catch {
        // ignore close errors
      }
    }
  } catch (err) {
    return errorResponse(err.message || "Internal server error", 500);
  }
});
