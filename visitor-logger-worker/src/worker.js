function corsHeaders(request, env) {
  const origin = request.headers.get("origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const isAllowed = allowed.includes(origin);
  return {
    "access-control-allow-origin": isAllowed ? origin : "null",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}

function shortText(value, maxLength) {
  return String(value || "").slice(0, maxLength);
}

function clientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  return (
    request.headers.get("cf-connecting-ip") ||
    forwarded.split(",")[0].trim() ||
    ""
  );
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function authorized(request, env) {
  const token = String(env.READ_TOKEN || "");
  if (!token) return false;
  return request.headers.get("authorization") === `Bearer ${token}`;
}

async function collect(request, env) {
  const cors = corsHeaders(request, env);
  const origin = request.headers.get("origin") || "";
  if (origin && cors["access-control-allow-origin"] !== origin) {
    return json({ ok: false, error: "origin_not_allowed" }, { status: 403, headers: cors });
  }

  let body = {};
  try {
    body = await request.json();
  } catch (_) {
    body = {};
  }

  const ip = clientIp(request);
  const ipHash = ip ? await sha256(`${env.IP_HASH_SALT || ""}:${ip}`) : "";
  const storeFullIp = String(env.STORE_FULL_IP || "true").toLowerCase() !== "false";
  const cf = request.cf || {};

  await env.DB.prepare(
    `INSERT INTO visits (
      ip, ip_hash, country, colo, path, title, referrer, user_agent,
      language, timezone, viewport, screen, session_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      storeFullIp ? shortText(ip, 128) : null,
      shortText(ipHash, 128),
      shortText(cf.country || "", 16),
      shortText(cf.colo || "", 16),
      shortText(body.path || "/", 600),
      shortText(body.title || "", 240),
      shortText(body.referrer || "", 1000),
      shortText(request.headers.get("user-agent") || "", 600),
      shortText(body.language || "", 80),
      shortText(body.timezone || cf.timezone || "", 120),
      shortText(body.viewport || "", 40),
      shortText(body.screen || "", 40),
      shortText(body.session_id || "", 80)
    )
    .run();

  return new Response(null, { status: 204, headers: cors });
}

async function recentVisits(request, env) {
  const cors = corsHeaders(request, env);
  if (!authorized(request, env)) return json({ ok: false, error: "unauthorized" }, { status: 401, headers: cors });
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(Number.parseInt(url.searchParams.get("limit") || "100", 10), 500));
  const { results } = await env.DB.prepare(
    `SELECT id, created_at, ip, ip_hash, country, colo, path, title, referrer,
            user_agent, language, timezone, viewport, screen, session_id
       FROM visits
      ORDER BY id DESC
      LIMIT ?`
  )
    .bind(limit)
    .all();
  return json({ ok: true, results }, { headers: cors });
}

async function summary(request, env) {
  const cors = corsHeaders(request, env);
  if (!authorized(request, env)) return json({ ok: false, error: "unauthorized" }, { status: 401, headers: cors });
  const [days, paths, countries] = await Promise.all([
    env.DB.prepare(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS visits, COUNT(DISTINCT ip_hash) AS unique_ips
         FROM visits
        GROUP BY day
        ORDER BY day DESC
        LIMIT 30`
    ).all(),
    env.DB.prepare(
      `SELECT path, COUNT(*) AS visits, COUNT(DISTINCT ip_hash) AS unique_ips
         FROM visits
        GROUP BY path
        ORDER BY visits DESC
        LIMIT 30`
    ).all(),
    env.DB.prepare(
      `SELECT country, COUNT(*) AS visits, COUNT(DISTINCT ip_hash) AS unique_ips
         FROM visits
        GROUP BY country
        ORDER BY visits DESC
        LIMIT 30`
    ).all(),
  ]);
  return json({
    ok: true,
    days: days.results || [],
    paths: paths.results || [],
    countries: countries.results || [],
  }, { headers: cors });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (url.pathname === "/health") {
      return json({ ok: true }, { headers: corsHeaders(request, env) });
    }
    if (url.pathname === "/collect" && request.method === "POST") {
      return collect(request, env);
    }
    if (url.pathname === "/admin/visits" && request.method === "GET") {
      return recentVisits(request, env);
    }
    if (url.pathname === "/admin/summary" && request.method === "GET") {
      return summary(request, env);
    }
    return json({ ok: false, error: "not_found" }, { status: 404 });
  },
};
