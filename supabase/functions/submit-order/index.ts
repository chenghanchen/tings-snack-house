import { createClient } from "npm:@supabase/supabase-js@2";
import { normalizeCustomerPhone, resolveCustomerIdentity } from "./customer-identity.mjs";

const encoder = new TextEncoder();
const productionOrigin = "https://tings-snack-house.pages.dev";
const allowedOrigins = new Set(
  (Deno.env.get("ORDER_ALLOWED_ORIGINS") ??
    `${productionOrigin},http://127.0.0.1:4173,http://localhost:4173`)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin":
      origin && allowedOrigins.has(origin) ? origin : productionOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(
  body: unknown,
  status: number,
  origin: string | null,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      ...extraHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") {
    if (origin && !allowedOrigins.has(origin))
      return json({ error: "Origin not allowed" }, 403, origin);
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405, origin);
  if (origin && !allowedOrigins.has(origin))
    return json({ error: "Origin not allowed" }, 403, origin);

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 32_768)
    return json({ error: "订单内容过大" }, 413, origin);

  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 32_768)
      return json({ error: "订单内容过大" }, 413, origin);
    body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body))
      return json({ error: "订单格式无效" }, 400, origin);
  } catch {
    return json({ error: "订单格式无效" }, 400, origin);
  }

  const phone = normalizeCustomerPhone(body.p_phone);
  const idempotencyKey = String(body.p_idempotency_key ?? "").trim();
  if (!phone)
    return json({ error: "请输入 10 位数字电话号码" }, 400, origin);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      idempotencyKey,
    )
  ) return json({ error: "订单幂等键无效" }, 400, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const rateLimitSalt = Deno.env.get("ORDER_RATE_LIMIT_SALT");
  if (!supabaseUrl || !serviceRoleKey || !rateLimitSalt)
    return json({ error: "订单服务尚未完成配置" }, 503, origin);

  const forwardedFor = request.headers.get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const clientAddress =
    request.headers.get("cf-connecting-ip") || forwardedFor || "unknown";
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let customerId: string | null;
  try {
    customerId = await resolveCustomerIdentity(
      request.headers.get("authorization"),
      Deno.env.get("ORDER_GUEST_ANON_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY"),
      (token: string) => admin.auth.getUser(token),
    );
  } catch (error) {
    const notConfigured = error instanceof Error && error.message === "AUTH_NOT_CONFIGURED";
    return json({ error: notConfigured ? "账户服务尚未完成配置" : "登录已失效，请重新登录后提交订单" },
      notConfigured ? 503 : 401, origin);
  }

  // Reject an empty cart before rate-limit counters or order RPCs are touched.
  // This also gives deployment checks a side-effect-free way to exercise auth.
  if (!Array.isArray(body.p_items) || body.p_items.length === 0)
    return json({ error: "购物车为空，请先选择商品" }, 400, origin);

  const windowSeconds = positiveInteger(
    Deno.env.get("ORDER_RATE_WINDOW_SECONDS"),
    600,
  );
  const checks = [
    {
      hash: await sha256(`${rateLimitSalt}:ip:${clientAddress}`),
      max: positiveInteger(Deno.env.get("ORDER_RATE_IP_MAX"), 8),
    },
    {
      hash: await sha256(`${rateLimitSalt}:phone:${phone}`),
      max: positiveInteger(Deno.env.get("ORDER_RATE_PHONE_MAX"), 4),
    },
  ];

  for (const check of checks) {
    const { data: allowed, error } = await admin.rpc(
      "check_order_submission_rate_limit",
      {
        p_identifier_hash: check.hash,
        p_max_requests: check.max,
        p_window_seconds: windowSeconds,
      },
    );
    if (error) {
      console.error("Order rate-limit check failed", error.code);
      return json({ error: "订单服务暂时不可用" }, 503, origin);
    }
    if (!allowed)
      return json(
        { error: "提交次数过多，请稍后再试" },
        429,
        origin,
        { "Retry-After": String(windowSeconds) },
      );
  }

  const rpcArgs = {
    p_user_id: customerId,
    p_customer_name: body.p_customer_name,
    p_phone: phone,
    p_email: body.p_email ?? null,
    p_fulfillment: body.p_fulfillment,
    p_address: body.p_address ?? null,
    p_note: body.p_note ?? null,
    p_items: body.p_items,
    p_idempotency_key: idempotencyKey,
    p_promotion_id: body.p_promotion_id ?? null,
    p_coupon_code: body.p_coupon_code ?? null,
    p_referral_value: body.p_referral_value ?? null,
    p_excluded_campaign_ids: body.p_excluded_campaign_ids ?? [],
  };
  const { data, error } = await admin.rpc(
    "submit_shop_order_account",
    rpcArgs,
  );
  if (error) {
    console.error("Order submission failed", error.code);
    return json({ error: error.message || "订单暂时无法提交" }, 400, origin);
  }
  return json(data, 200, origin);
});
