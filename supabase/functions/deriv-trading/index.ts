import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DERIV_WS_URL = "wss://ws.derivws.com/websockets/v3?app_id=1089";

interface DerivTickResponse {
  tick?: {
    ask: number;
    bid: number;
    epoch: number;
    id: string;
    pip_size: number;
    quote: number;
    symbol: string;
  };
  error?: { code: string; message: string };
}

// Helper to send a message to Deriv WS and get a response
function derivRequest(ws: WebSocket, msg: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const reqId = Math.floor(Math.random() * 1e9);
    const payload = { ...msg, req_id: reqId };

    const timeout = setTimeout(() => {
      reject(new Error("Deriv WS request timed out"));
    }, 15000);

    const handler = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.req_id === reqId) {
          ws.removeEventListener("message", handler);
          clearTimeout(timeout);
          if (data.error) {
            reject(new Error(`Deriv API error: ${data.error.message} (${data.error.code})`));
          } else {
            resolve(data);
          }
        }
      } catch (e) {
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
      reject(new Error("Deriv WS connection timeout"));
    }, 10000);

    ws.onopen = () => {
      clearTimeout(timeout);
      resolve(ws);
    };
    ws.onerror = (e) => {
      clearTimeout(timeout);
      reject(new Error("Failed to connect to Deriv WebSocket"));
    };
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    const DERIV_TOKEN = Deno.env.get("DERIV_API_TOKEN");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    if (!DERIV_TOKEN) {
      return new Response(
        JSON.stringify({ error: "DERIV_API_TOKEN not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let ws: WebSocket;
    try {
      ws = await connectDeriv();
    } catch (err) {
      return new Response(
        JSON.stringify({ error: `WebSocket connection failed: ${err.message}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    try {
      // Authorize
      const authRes = await derivRequest(ws, { authorize: DERIV_TOKEN });
      if (!authRes.authorize) {
        throw new Error("Authorization failed");
      }

      const accountInfo = authRes.authorize;

      if (action === "balance") {
        return new Response(
          JSON.stringify({
            balance: accountInfo.balance,
            currency: accountInfo.currency,
            loginid: accountInfo.loginid,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (action === "buy" && req.method === "POST") {
        const body = await req.json();
        const { symbol, amount, contract_type, duration, duration_unit } = body;

        if (!symbol || !amount || !contract_type) {
          return new Response(
            JSON.stringify({ error: "Missing required fields: symbol, amount, contract_type" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Get proposal first
        const proposalRes = await derivRequest(ws, {
          proposal: 1,
          amount: amount,
          basis: "stake",
          contract_type: contract_type,
          currency: accountInfo.currency,
          duration: duration || 5,
          duration_unit: duration_unit || "m",
          underlying_symbol: symbol,
        });

        if (!proposalRes.proposal) {
          throw new Error("Failed to get price proposal");
        }

        // Buy the contract
        const buyRes = await derivRequest(ws, {
          buy: proposalRes.proposal.id,
          price: proposalRes.proposal.ask_price,
        });

        const buyData = buyRes.buy;

        // Log the trade to database
        await supabase.from("trade_logs").insert({
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
          source: body.source || "manual",
          result: "PENDING",
          metadata: {
            payout: buyData.payout,
            longcode: buyData.longcode,
            shortcode: buyData.shortcode,
            purchase_time: buyData.purchase_time,
            start_time: buyData.start_time,
          },
        });

        return new Response(
          JSON.stringify({
            success: true,
            contract_id: buyData.contract_id,
            buy_price: buyData.buy_price,
            payout: buyData.payout,
            balance_after: buyData.balance_after,
            longcode: buyData.longcode,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (action === "sell" && req.method === "POST") {
        const body = await req.json();
        const { contract_id, price } = body;

        if (!contract_id) {
          return new Response(
            JSON.stringify({ error: "Missing contract_id" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const sellRes = await derivRequest(ws, {
          sell: contract_id,
          price: price || 0,
        });

        const sellData = sellRes.sell;

        // Update trade log
        await supabase
          .from("trade_logs")
          .update({
            exit_price: sellData.sold_for,
            profit: sellData.sold_for - (price || 0),
            balance_after: sellData.balance_after,
            result: sellData.sold_for > 0 ? "WIN" : "LOSS",
          })
          .eq("contract_id", contract_id);

        return new Response(
          JSON.stringify({
            success: true,
            sold_for: sellData.sold_for,
            balance_after: sellData.balance_after,
            contract_id: sellData.contract_id,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (action === "contract_status" && req.method === "POST") {
        const body = await req.json();
        const { contract_id } = body;

        const statusRes = await derivRequest(ws, {
          proposal_open_contract: 1,
          contract_id,
        });

        return new Response(
          JSON.stringify(statusRes.proposal_open_contract || statusRes),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

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

        return new Response(
          JSON.stringify(histRes.history || histRes),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (action === "active_symbols") {
        const symbolsRes = await derivRequest(ws, {
          active_symbols: "brief",
          product_type: "basic",
        });

        // Filter to synthetics
        const synthetics = (symbolsRes.active_symbols || []).filter(
          (s: any) => s.market === "synthetic_index"
        );

        return new Response(
          JSON.stringify(synthetics),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          error: "Unknown action. Use: balance, buy, sell, contract_status, ticks, active_symbols",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } finally {
      try { ws.close(); } catch {}
    }
  } catch (err) {
    console.error("deriv-trading error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
