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

function normalizeDerivDuration(duration: unknown, durationUnit: unknown) {
  const normalizedUnit = typeof durationUnit === "string" && durationUnit ? durationUnit : "m";
  const numericDuration = Number(duration ?? 5);

  if (!Number.isFinite(numericDuration) || numericDuration <= 0) {
    throw new Error("Invalid trade duration");
  }

  if (normalizedUnit === "m" && numericDuration % 1 !== 0) {
    return {
      duration: Math.round(numericDuration * 60),
      durationUnit: "s",
      durationMinutes: numericDuration,
    };
  }

  const safeDuration = Math.round(numericDuration);

  return {
    duration: safeDuration,
    durationUnit: normalizedUnit,
    durationMinutes: normalizedUnit === "s" ? safeDuration / 60 : safeDuration,
  };
}

// Read user-updated token from engine_secrets DB (priority over env vars)
async function getTokenFromDB(supabase: any): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("engine_secrets")
      .select("value")
      .eq("key", "deriv_api_token")
      .single();
    return data?.value || null;
  } catch {
    return null;
  }
}

// Telegram bot helper
async function sendTelegramMessage(text: string, replyMarkup?: any): Promise<void> {
  const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID");

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn("[Telegram] Bot token or chat ID not configured, skipping");
    return;
  }

  try {
    const body: any = {
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };
    if (replyMarkup) {
      body.reply_markup = replyMarkup;
    }

    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[Telegram] Send failed:", err);
    }
  } catch (err) {
    console.error("[Telegram] Network error:", err);
  }
}

// Symbol display names (correct Deriv API symbols)
const SYMBOL_NAMES: Record<string, string> = {
  "1HZ10V": "Volatility 10 (1s) Index", "R_10": "Volatility 10 Index",
  "1HZ15V": "Volatility 15 (1s) Index", "1HZ25V": "Volatility 25 (1s) Index",
  "R_25": "Volatility 25 Index", "1HZ30V": "Volatility 30 (1s) Index",
  "1HZ50V": "Volatility 50 (1s) Index", "R_50": "Volatility 50 Index",
  "1HZ75V": "Volatility 75 (1s) Index", "R_75": "Volatility 75 Index",
  "1HZ90V": "Volatility 90 (1s) Index", "1HZ100V": "Volatility 100 (1s) Index",
  "R_100": "Volatility 100 Index",
  "stpRNG": "Step Index 100", "stpRNG2": "Step Index 200",
  "stpRNG3": "Step Index 300", "stpRNG4": "Step Index 400",
  "stpRNG5": "Step Index 500",
  "JD10": "Jump 10 Index", "JD25": "Jump 25 Index",
  "JD50": "Jump 50 Index", "JD75": "Jump 75 Index",
  "JD100": "Jump 100 Index",
};

// ─── Professional Telegram Signal Formatter ──────────────────

function formatSignalTelegram(body: any): string {
  const {
    symbol, type, price, score, confidence, details, logic, pattern, metrics
  } = body;

  const name = SYMBOL_NAMES[symbol] || symbol;
  const emoji = type === "BUY" ? "🟢" : "🔴";
  const action = type === "BUY" ? "BUY / RISE" : "SELL / FALL";
  const now = new Date();
  const time = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });

  // Confidence bar visualization
  const conf = Number(confidence || score || 0);
  const barLen = 10;
  const filled = Math.round((conf / 100) * barLen);
  const confBar = "█".repeat(filled) + "░".repeat(barLen - filled);

  // RSI zone label
  let rsiZone = "";
  if (metrics?.rsi != null) {
    const rsi = Number(metrics.rsi);
    if (rsi < 30) rsiZone = " ⚠️ OVERSOLD";
    else if (rsi > 70) rsiZone = " ⚠️ OVERBOUGHT";
    else if (rsi < 40) rsiZone = " 🔽 Approaching OS";
    else if (rsi > 60) rsiZone = " 🔼 Approaching OB";
  }

  // Trend strength label
  let trendLabel = "";
  if (metrics?.trend_strength != null) {
    const ts = Number(metrics.trend_strength);
    if (ts > 60) trendLabel = "🔥 STRONG";
    else if (ts > 30) trendLabel = "⚡ MODERATE";
    else trendLabel = "〰️ WEAK";
  }

  const lines: string[] = [
    `${emoji} <b>Confidence: ${conf.toFixed(1)}%</b>`,
    `<code>${confBar}</code>`,
    ``,
    `⚡ <b>ACTION: ${action}</b>`,
    `📊 <b>Symbol:</b> ${name}`,
    `💰 <b>Entry:</b> <code>${Number(price).toFixed(2)}</code>`,
    `⏰ <b>Time:</b> ${time}`,
  ];

  if (pattern) {
    lines.push(``, `🔥 <b>${pattern}</b>`);
  }

  lines.push(``, `📐 <b>Technical Metrics:</b>`);

  if (metrics) {
    if (metrics.ema9 != null && metrics.ema21 != null) {
      const emaDiff = Number(metrics.ema9) - Number(metrics.ema21);
      const emaDir = emaDiff > 0 ? "↑" : "↓";
      lines.push(`EMA 9/21: <code>${Number(metrics.ema9).toFixed(2)} / ${Number(metrics.ema21).toFixed(2)}</code> ${emaDir}`);
    }
    if (metrics.rsi != null) lines.push(`RSI (14): <code>${Number(metrics.rsi).toFixed(1)}</code>${rsiZone}`);
    if (metrics.macd_histogram != null) {
      const macdDir = Number(metrics.macd_histogram) > 0 ? "↑" : "↓";
      lines.push(`MACD: <code>${Number(metrics.macd_histogram).toFixed(4)}</code> ${macdDir} (${metrics.macd_cross || "—"})`);
    }
    if (metrics.bb_percentB != null) {
      const bbPct = (Number(metrics.bb_percentB) * 100).toFixed(0);
      lines.push(`BB %B: <code>${bbPct}%</code> (${metrics.bb_position || "—"})`);
    }
    if (metrics.stoch_k != null) {
      lines.push(`Stoch: <code>K:${Number(metrics.stoch_k).toFixed(0)} / D:${Number(metrics.stoch_d || 0).toFixed(0)}</code> (${metrics.stoch_signal || "—"})`);
    }
    if (metrics.atr != null) lines.push(`ATR (14): <code>${Number(metrics.atr).toFixed(4)}</code>`);
    if (metrics.ema_gap_pct != null) lines.push(`EMA Gap: <code>${Number(metrics.ema_gap_pct).toFixed(4)}%</code>`);
    if (metrics.ema_slope != null) lines.push(`Slope: <code>${Number(metrics.ema_slope).toFixed(6)}</code>`);
    if (metrics.divergence) lines.push(`📉 Divergence: <code>${metrics.divergence}</code> (str: ${Number(metrics.divergence_strength || 0).toFixed(0)})`);
    if (metrics.engulfing) lines.push(`🕯 Engulfing: <code>${metrics.engulfing}</code> (str: ${Number(metrics.engulfing_strength || 0).toFixed(0)})`);
    if (trendLabel) lines.push(`📊 Trend: ${trendLabel} (${Number(metrics.trend_strength).toFixed(0)}%)`);
    if (metrics.confluence_count != null) {
      lines.push(`🎯 Confluence: <code>${metrics.confluence_count}/${metrics.confluence_required || 3}</code> indicators agree`);
    }
  }

  lines.push(
    ``,
    `─────────────────`,
    `💡 <b>Logic:</b> ${logic || details || "—"}`,
    ``,
    `📌 <i>5-min scalping | Best of ${Object.keys(SYMBOL_NAMES).length} markets</i>`,
    `🤖 <i>DNN Deriv Engine v5.0 SMC+MTF</i>`
  );

  return lines.join("\n");
}

// Build Telegram inline keyboard for quick trade
function buildQuickTradeKeyboard(symbol: string, type: "BUY" | "SELL", price: number): any {
  const contractType = type === "BUY" ? "CALL" : "PUT";
  // Callback data format: qt:<symbol>:<contractType>:<accountType>:<amount>
  return {
    inline_keyboard: [
      [
        {
          text: `⚡ Quick ${type} (Demo $10)`,
          callback_data: `qt:${symbol}:${contractType}:demo:10`,
        },
        {
          text: `⚡ Quick ${type} (Demo $25)`,
          callback_data: `qt:${symbol}:${contractType}:demo:25`,
        },
      ],
      [
        {
          text: `🔴 Live ${type} ($0.35)`,
          callback_data: `qt:${symbol}:${contractType}:live:0.35`,
        },
        {
          text: `🔴 Live ${type} ($1.00)`,
          callback_data: `qt:${symbol}:${contractType}:live:1`,
        },
      ],
      [
        {
          text: `🤖 Start Auto (Demo)`,
          callback_data: `auto:demo:${symbol}`,
        },
      ],
    ],
  };
}

function formatSettlementTelegram(contractId: number, symbol: string, profit: number, balanceAfter?: number): string {
  const name = SYMBOL_NAMES[symbol] || symbol;
  const isWin = profit >= 0;
  const emoji = isWin ? "✅" : "❌";

  const lines = [
    `${emoji} <b>Trade ${isWin ? "WON" : "LOST"}</b>`,
    ``,
    `📊 ${name}`,
    `💰 P&L: <code>${isWin ? "+" : ""}$${profit.toFixed(2)}</code>`,
    `📋 Contract: <code>#${contractId}</code>`,
  ];

  if (balanceAfter != null) {
    lines.push(`💼 Balance: <code>$${Number(balanceAfter).toFixed(2)}</code>`);
  }

  lines.push(`⏰ ${new Date().toLocaleTimeString("en-US", { hour12: true })}`);

  return lines.join("\n");
}

// ─── Account Authorization (ROBUST + DB Token Support) ──────

async function authorizeForAccount(
  ws: WebSocket,
  requestedAccountType: "demo" | "live",
  supabase: any
): Promise<{ auth: any; actualType: "demo" | "live" }> {
  // Priority 1: User-updated token from engine_secrets DB
  const dbToken = await getTokenFromDB(supabase);
  // Priority 2: Environment variables
  const envToken = Deno.env.get("DERIV_API_TOKEN");
  const DERIV_LIVE_TOKEN = Deno.env.get("DERIV_LIVE_API_TOKEN");
  
  // Select primary token: DB token takes precedence over env
  const DERIV_TOKEN = dbToken || envToken;

  if (dbToken) {
    console.log("[deriv-trading] Using user-updated token from engine_secrets DB");
  }

  // For live accounts, try dedicated live token first
  if (requestedAccountType === "live" && DERIV_LIVE_TOKEN) {
    console.log("[deriv-trading] Using dedicated DERIV_LIVE_API_TOKEN for live account");
    const authRes = await derivRequest(ws, { authorize: DERIV_LIVE_TOKEN });
    if (!authRes.authorize) throw new Error("Live token authorization failed");
    const isVirtual = !!authRes.authorize.is_virtual;
    if (isVirtual) {
      throw new Error("DERIV_LIVE_API_TOKEN is a demo token — please update it with a real account API token");
    }
    return { auth: authRes.authorize, actualType: "live" };
  }

  if (!DERIV_TOKEN) throw new Error("DERIV_API_TOKEN not configured. Update your token via the Key icon in the header.");
  
  const authRes = await derivRequest(ws, { authorize: DERIV_TOKEN });
  if (!authRes.authorize) throw new Error("Deriv authorization failed — token may be invalid or expired");
  
  const initialAuth = authRes.authorize;
  const isCurrentVirtual = !!initialAuth.is_virtual;
  const wantVirtual = requestedAccountType === "demo";

  if (isCurrentVirtual === wantVirtual) {
    console.log(`[deriv-trading] Token matches ${requestedAccountType}: ${initialAuth.loginid} (source: ${dbToken ? "DB" : "env"})`);
    return { auth: initialAuth, actualType: requestedAccountType };
  }

  // Try account switching via account_list
  const accountList = initialAuth.account_list || [];
  const targetAccount = accountList.find((acc: any) =>
    wantVirtual ? acc.is_virtual === 1 : acc.is_virtual === 0
  );

  if (targetAccount?.token) {
    console.log(`[deriv-trading] Switching to ${requestedAccountType} via account_list: ${targetAccount.loginid}`);
    const switchRes = await derivRequest(ws, { authorize: targetAccount.token });
    if (switchRes.authorize) {
      const switchedVirtual = !!switchRes.authorize.is_virtual;
      console.log(`[deriv-trading] Switched → ${switchRes.authorize.loginid} (${switchedVirtual ? "demo" : "live"}) | Balance: ${switchRes.authorize.balance} ${switchRes.authorize.currency}`);
      return { auth: switchRes.authorize, actualType: switchedVirtual ? "demo" : "live" };
    }
  }

  if (requestedAccountType === "live") {
    const msg = `Cannot switch to live account. Your API token doesn't have 'admin' scope for account switching. ` +
      `Please either: (1) Create a new API token with 'Admin' scope on deriv.com, or ` +
      `(2) Add a dedicated live account token as DERIV_LIVE_API_TOKEN secret, or ` +
      `(3) Update your token via the Key icon in the header with a live account token.`;
    console.error(`[deriv-trading] ${msg}`);
    throw new Error(msg);
  }

  console.warn(`[deriv-trading] Cannot switch to demo from live account. Using current: ${initialAuth.loginid}`);
  return { auth: initialAuth, actualType: isCurrentVirtual ? "demo" : "live" };
}

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
    if (!DERIV_TOKEN && !["telegram_signal", "test_token", "update_token"].includes(action)) {
      return errorResponse("DERIV_API_TOKEN not configured", 500);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // ── TEST TOKEN (verify a Deriv API token) ──
    if (action === "test_token" && req.method === "POST") {
      const body = await req.json();
      const token = body.token;
      if (!token) return errorResponse("Missing token", 400);
      let ws: WebSocket;
      try { ws = await connectDeriv(); } catch (err) { return errorResponse(`WS failed: ${err.message}`, 502); }
      try {
        const authRes = await derivRequest(ws, { authorize: token });
        if (!authRes.authorize) return jsonResponse({ valid: false, error: "Authorization failed" });
        const acct = authRes.authorize;
        ws.close();
        return jsonResponse({ valid: true, loginid: acct.loginid, is_virtual: !!acct.is_virtual, balance: acct.balance, currency: acct.currency });
      } catch (err) {
        ws.close();
        return jsonResponse({ valid: false, error: err.message });
      }
    }

    // ── UPDATE TOKEN (save to engine_secrets) ──
    if (action === "update_token" && req.method === "POST") {
      const body = await req.json();
      const token = body.token;
      if (!token) return errorResponse("Missing token", 400);
      const { error: upsertErr } = await supabase.from("engine_secrets").upsert(
        { key: "deriv_api_token", value: token, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
      if (upsertErr) return errorResponse(`Failed to save: ${upsertErr.message}`, 500);
      return jsonResponse({ success: true, message: "Token saved" });
    }

    // ── TELEGRAM SIGNAL (no Deriv WS needed) ──
    if (action === "telegram_signal" && req.method === "POST") {
      const body = await req.json();
      const message = formatSignalTelegram(body);
      await sendTelegramMessage(message);
      return jsonResponse({ success: true, message: "Signal sent to Telegram" });
    }

    // Determine requested account type
    let requestedAccountType: "demo" | "live" = "demo";
    const accountTypeParam = url.searchParams.get("account_type");
    if (accountTypeParam === "demo" || accountTypeParam === "live") {
      requestedAccountType = accountTypeParam;
    }

    let parsedBody: any = null;
    if (req.method === "POST") {
      try {
        const bodyText = await req.text();
        parsedBody = bodyText ? JSON.parse(bodyText) : {};
      } catch {
        parsedBody = {};
      }
      if (parsedBody.account_type === "demo" || parsedBody.account_type === "live") {
        requestedAccountType = parsedBody.account_type;
      }
    }

    let ws: WebSocket;
    try {
      ws = await connectDeriv();
    } catch (err) {
      return errorResponse(`WebSocket connection failed: ${err.message}`, 502);
    }

    try {
      const { auth: acct, actualType } = await authorizeForAccount(ws, requestedAccountType);

      console.log(`[deriv-trading] Authorized: ${acct.loginid} (${actualType}) | Balance: ${acct.balance} ${acct.currency} | Action: ${action} | Requested: ${requestedAccountType}`);

      if (actualType !== requestedAccountType) {
        return errorResponse(
          `Account type mismatch: requested ${requestedAccountType} but authorized as ${actualType} (${acct.loginid}). Check your API token configuration.`,
          400
        );
      }

      // ── BALANCE ──
      if (action === "balance") {
        const balRes = await derivRequest(ws, { balance: 1 });
        const bal = balRes.balance || {};
        return jsonResponse({
          balance: bal.balance ?? acct.balance,
          currency: bal.currency ?? acct.currency,
          loginid: acct.loginid,
          is_virtual: !!acct.is_virtual,
          account_type: actualType,
        });
      }

      // ── BUY ──
      if (action === "buy") {
        const body = parsedBody || {};
        const { symbol, amount, contract_type, duration, duration_unit, source } = body;

        if (!symbol || !amount || !contract_type) {
          return errorResponse("Missing: symbol, amount, contract_type", 400);
        }
        if (amount < 0.35) {
          return errorResponse("Minimum trade amount is $0.35", 400);
        }

        const {
          duration: normalizedDuration,
          durationUnit: normalizedDurationUnit,
          durationMinutes,
        } = normalizeDerivDuration(duration, duration_unit);

        console.log(
          `[deriv-trading] Buy request: ${symbol} ${contract_type} | ${normalizedDuration}${normalizedDurationUnit} | stake ${amount}`
        );

        const proposalRes = await derivRequest(ws, {
          proposal: 1,
          amount,
          basis: "stake",
          contract_type,
          currency: acct.currency,
          duration: normalizedDuration,
          duration_unit: normalizedDurationUnit,
          symbol,
        });

        if (!proposalRes.proposal) {
          throw new Error("Failed to get proposal from Deriv");
        }

        const buyRes = await derivRequest(ws, {
          buy: proposalRes.proposal.id,
          price: proposalRes.proposal.ask_price,
        });

        const buyData = buyRes.buy;
        console.log(`[deriv-trading] Bought contract ${buyData.contract_id} | Price: ${buyData.buy_price} | Account: ${acct.loginid} (${actualType})`);

        await supabase.from("trade_logs").insert({
          symbol,
          trade_type: contract_type === "CALL" ? "BUY" : "SELL",
          contract_type,
          amount: buyData.buy_price,
          entry_price: proposalRes.proposal.spot,
          contract_id: buyData.contract_id,
          transaction_id: buyData.transaction_id,
          balance_after: buyData.balance_after,
          duration_minutes: durationMinutes,
          account_type: actualType,
          currency: acct.currency,
          source: source || "manual",
          result: "PENDING",
          metadata: {
            payout: buyData.payout,
            longcode: buyData.longcode,
            purchase_time: buyData.purchase_time,
            loginid: acct.loginid,
          },
        });

        return jsonResponse({
          success: true,
          contract_id: buyData.contract_id,
          buy_price: buyData.buy_price,
          payout: buyData.payout,
          balance_after: buyData.balance_after,
          longcode: buyData.longcode,
          account_type: actualType,
          loginid: acct.loginid,
        });
      }

      // ── SETTLE ──
      if (action === "settle") {
        const body = parsedBody || {};
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

            await sendTelegramMessage(
              formatSettlementTelegram(contract_id, contract.underlying, profit, sellData.balance_after)
            );

            return jsonResponse({
              settled: true,
              sold_for: sellData.sold_for,
              profit,
              balance_after: sellData.balance_after,
              status: "SOLD",
              account_type: actualType,
            });
          } catch (sellErr) {
            console.warn(`[deriv-trading] Cannot sell ${contract_id}: ${sellErr.message}`);
          }
        }

        if (isExpired || contract.is_sold) {
          const profit = (contract.sell_price || contract.bid_price || 0) - contract.buy_price;
          const result = profit >= 0 ? "WIN" : "LOSS";

          let balanceAfter = contract.balance_after || null;
          if (!balanceAfter) {
            try {
              const balRes = await derivRequest(ws, { balance: 1 });
              balanceAfter = balRes.balance?.balance ?? null;
            } catch { /* use null */ }
          }

          await supabase
            .from("trade_logs")
            .update({
              exit_price: contract.exit_tick || contract.current_spot,
              profit,
              balance_after: balanceAfter,
              result,
            })
            .eq("contract_id", contract_id);

          await sendTelegramMessage(
            formatSettlementTelegram(contract_id, contract.underlying, profit, balanceAfter)
          );

          return jsonResponse({
            settled: true,
            profit,
            status: contract.status,
            sell_price: contract.sell_price || contract.bid_price,
            balance_after: balanceAfter,
            account_type: actualType,
          });
        }

        return jsonResponse({
          settled: false,
          status: "OPEN",
          current_spot: contract.current_spot,
          entry_spot: contract.entry_spot,
          profit: contract.profit,
          is_valid_to_sell: contract.is_valid_to_sell,
          date_expiry: contract.date_expiry,
          account_type: actualType,
        });
      }

      // ── SELL ──
      if (action === "sell") {
        const body = parsedBody || {};
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
          account_type: actualType,
        });
      }

      // ── CONTRACT STATUS ──
      if (action === "contract_status") {
        const body = parsedBody || {};
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
