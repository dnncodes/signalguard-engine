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
        // ignore
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

// Telegram bot helper
async function sendTelegramMessage(text: string): Promise<void> {
  const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID");

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn("[Telegram] Bot token or chat ID not configured, skipping");
    return;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[Telegram] Send failed:", err);
    }
  } catch (err) {
    console.error("[Telegram] Network error:", err);
  }
}

// Symbol display names
const SYMBOL_NAMES: Record<string, string> = {
  "1HZ10V": "Vol 10 (1s)", "R_10": "Vol 10", "1HZ15V": "Vol 15 (1s)",
  "1HZ25V": "Vol 25 (1s)", "R_25": "Vol 25", "1HZ30V": "Vol 30 (1s)",
  "1HZ50V": "Vol 50 (1s)", "R_50": "Vol 50", "1HZ75V": "Vol 75 (1s)",
  "R_75": "Vol 75", "1HZ90V": "Vol 90 (1s)", "1HZ100V": "Vol 100 (1s)",
  "R_100": "Vol 100", "BOOM500": "Boom 500", "BOOM1000": "Boom 1000",
  "CRASH500": "Crash 500", "CRASH1000": "Crash 1000",
  "JD10": "Jump 10", "JD25": "Jump 25", "JD50": "Jump 50",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (!action) {
      return errorResponse("Missing 'action' query parameter", 400);
    }

    const DERIV_TOKEN = Deno.env.get("DERIV_API_TOKEN");
    if (!DERIV_TOKEN && action !== "telegram_signal") {
      return errorResponse("DERIV_API_TOKEN not configured", 500);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // ── TELEGRAM SIGNAL (no Deriv WS needed) ──
    if (action === "telegram_signal" && req.method === "POST") {
      const body = await req.json();
      const { symbol, type, price, score, details } = body;
      const name = SYMBOL_NAMES[symbol] || symbol;
      const emoji = type === "BUY" ? "🟢" : "🔴";
      const arrow = type === "BUY" ? "⬆️" : "⬇️";

      const message = [
        `${emoji} <b>${type} SIGNAL</b> ${arrow}`,
        ``,
        `📊 <b>${name}</b> (${symbol})`,
        `💰 Price: <code>${Number(price).toFixed(2)}</code>`,
        `🎯 Score: <b>${score || 0}/100</b>`,
        ``,
        `📝 ${details}`,
        ``,
        `⏰ ${new Date().toLocaleTimeString("en-US", { hour12: false })} UTC`,
        `🤖 <i>DNN Deriv Engine v2.1</i>`,
      ].join("\n");

      await sendTelegramMessage(message);
      return jsonResponse({ success: true, message: "Signal sent to Telegram" });
    }

    let ws: WebSocket;
    try {
      ws = await connectDeriv();
    } catch (err) {
      return errorResponse(`WebSocket connection failed: ${err.message}`, 502);
    }

    try {
      const authRes = await derivRequest(ws, { authorize: DERIV_TOKEN });
      if (!authRes.authorize) {
        throw new Error("Deriv authorization failed");
      }

      const acct = authRes.authorize;
      console.log(`[deriv-trading] Authorized: ${acct.loginid} | Action: ${action}`);

      // ── BALANCE ──
      if (action === "balance") {
        return jsonResponse({
          balance: acct.balance,
          currency: acct.currency,
          loginid: acct.loginid,
        });
      }

      // ── BUY ──
      if (action === "buy" && req.method === "POST") {
        const body = await req.json();
        const { symbol, amount, contract_type, duration, duration_unit, source } = body;

        if (!symbol || !amount || !contract_type) {
          return errorResponse("Missing: symbol, amount, contract_type", 400);
        }
        if (amount < 0.35) {
          return errorResponse("Minimum trade amount is $0.35", 400);
        }

        const dur = duration || 5;
        const durUnit = duration_unit || "m";

        const proposalRes = await derivRequest(ws, {
          proposal: 1,
          amount,
          basis: "stake",
          contract_type,
          currency: acct.currency,
          duration: dur,
          duration_unit: durUnit,
          symbol,
        });

        if (!proposalRes.proposal) {
          throw new Error("Failed to get proposal from Deriv");
        }

        console.log(`[deriv-trading] Proposal: ${proposalRes.proposal.id} | Ask: ${proposalRes.proposal.ask_price}`);

        const buyRes = await derivRequest(ws, {
          buy: proposalRes.proposal.id,
          price: proposalRes.proposal.ask_price,
        });

        const buyData = buyRes.buy;
        console.log(`[deriv-trading] Bought contract ${buyData.contract_id} | Price: ${buyData.buy_price}`);

        // Log to database
        await supabase.from("trade_logs").insert({
          symbol,
          trade_type: contract_type === "CALL" ? "BUY" : "SELL",
          contract_type,
          amount: buyData.buy_price,
          entry_price: proposalRes.proposal.spot,
          contract_id: buyData.contract_id,
          transaction_id: buyData.transaction_id,
          balance_after: buyData.balance_after,
          duration_minutes: dur,
          account_type: acct.is_virtual ? "demo" : "live",
          currency: acct.currency,
          source: source || "manual",
          result: "PENDING",
          metadata: {
            payout: buyData.payout,
            longcode: buyData.longcode,
            purchase_time: buyData.purchase_time,
          },
        });

        return jsonResponse({
          success: true,
          contract_id: buyData.contract_id,
          buy_price: buyData.buy_price,
          payout: buyData.payout,
          balance_after: buyData.balance_after,
          longcode: buyData.longcode,
        });
      }

      // ── SETTLE — Check and close expired contracts ──
      if (action === "settle" && req.method === "POST") {
        const body = await req.json();
        const { contract_id } = body;

        if (!contract_id) {
          return errorResponse("Missing contract_id", 400);
        }

        const statusRes = await derivRequest(ws, {
          proposal_open_contract: 1,
          contract_id,
        });

        const contract = statusRes.proposal_open_contract;
        if (!contract) {
          return errorResponse("Contract not found", 404);
        }

        const isExpired = contract.is_expired || contract.is_settleable;
        const isOpen = !isExpired && !contract.is_sold;

        // If still open and past expiry, try to sell
        if (isOpen && contract.is_valid_to_sell) {
          try {
            const sellRes = await derivRequest(ws, {
              sell: contract_id,
              price: 0,
            });
            const sellData = sellRes.sell;
            const profit = sellData.sold_for - contract.buy_price;

            await supabase
              .from("trade_logs")
              .update({
                exit_price: contract.current_spot,
                profit,
                balance_after: sellData.balance_after,
                result: profit >= 0 ? "WIN" : "LOSS",
              })
              .eq("contract_id", contract_id);

            console.log(`[deriv-trading] Settled ${contract_id}: sold for ${sellData.sold_for} | Profit: ${profit}`);

            // Send Telegram notification for settled trade
            const name = SYMBOL_NAMES[contract.underlying] || contract.underlying;
            const resultEmoji = profit >= 0 ? "✅" : "❌";
            await sendTelegramMessage(
              `${resultEmoji} <b>Trade Settled</b>\n\n` +
              `📊 ${name}\n` +
              `💰 Profit: <code>$${profit.toFixed(2)}</code>\n` +
              `📋 Contract: #${contract_id}`
            );

            return jsonResponse({
              settled: true,
              sold_for: sellData.sold_for,
              profit,
              balance_after: sellData.balance_after,
              status: "SOLD",
            });
          } catch (sellErr) {
            console.warn(`[deriv-trading] Cannot sell ${contract_id}: ${sellErr.message}`);
          }
        }

        // Already expired/settled
        if (isExpired || contract.is_sold) {
          const profit = (contract.sell_price || contract.bid_price || 0) - contract.buy_price;
          const result = profit >= 0 ? "WIN" : "LOSS";

          await supabase
            .from("trade_logs")
            .update({
              exit_price: contract.exit_tick || contract.current_spot,
              profit,
              balance_after: contract.balance_after || null,
              result,
            })
            .eq("contract_id", contract_id);

          console.log(`[deriv-trading] Contract ${contract_id} already settled: ${result} | Profit: ${profit}`);

          const name = SYMBOL_NAMES[contract.underlying] || contract.underlying;
          const resultEmoji = profit >= 0 ? "✅" : "❌";
          await sendTelegramMessage(
            `${resultEmoji} <b>Trade Settled</b>\n\n` +
            `📊 ${name}\n` +
            `💰 Profit: <code>$${profit.toFixed(2)}</code>\n` +
            `📋 Contract: #${contract_id}`
          );

          return jsonResponse({
            settled: true,
            profit,
            status: contract.status,
            sell_price: contract.sell_price || contract.bid_price,
          });
        }

        // Still running
        return jsonResponse({
          settled: false,
          status: "OPEN",
          current_spot: contract.current_spot,
          entry_spot: contract.entry_spot,
          profit: contract.profit,
          is_valid_to_sell: contract.is_valid_to_sell,
          date_expiry: contract.date_expiry,
        });
      }

      // ── SELL ──
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

        await supabase
          .from("trade_logs")
          .update({
            exit_price: sellData.sold_for,
            profit: sellData.sold_for - (price || 0),
            balance_after: sellData.balance_after,
            result: sellData.sold_for > 0 ? "WIN" : "LOSS",
          })
          .eq("contract_id", contract_id);

        return jsonResponse({
          success: true,
          sold_for: sellData.sold_for,
          balance_after: sellData.balance_after,
        });
      }

      // ── CONTRACT STATUS ──
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

      // ── TICK HISTORY ──
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

      // ── ACTIVE SYMBOLS ──
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

      return errorResponse("Unknown action", 400);
    } finally {
      try { ws.close(); } catch { /* ignore */ }
    }
  } catch (err) {
    return errorResponse(err.message || "Internal server error", 500);
  }
});
