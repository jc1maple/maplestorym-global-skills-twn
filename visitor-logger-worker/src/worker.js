const MOBILE_TO_PC = [4, 5, 6, 1, 2, 3, 0, 7];

function corsHeaders(request, env, allowNullOrigin = false) {
  const origin = request.headers.get("origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const isAllowed = allowed.includes(origin) || (allowNullOrigin && origin === "null");
  return {
    "access-control-allow-origin": isAllowed ? origin : (allowed[0] || ""),
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization, idempotency-key",
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

function isDownloadedLocalPath(path) {
  const value = String(path || "").replace(/\\/g, "/");
  const lower = value.toLowerCase();
  if (!lower.includes("maplestorym-global-skills-twn")) return false;
  return (
    /^\/[a-z]:\//i.test(value) ||
    lower.startsWith("/users/") ||
    lower.startsWith("/home/") ||
    lower.startsWith("/private/") ||
    lower.startsWith("/storage/emulated/")
  );
}

async function collect(request, env) {
  let body = {};
  try {
    body = await request.json();
  } catch (_) {
    body = {};
  }

  const origin = request.headers.get("origin") || "";
  const isLocalDownload = origin === "null" && isDownloadedLocalPath(body.path);
  const cors = corsHeaders(request, env, isLocalDownload);
  if ((!origin || cors["access-control-allow-origin"] !== origin) && !isLocalDownload) {
    return json({ ok: false, error: "origin_not_allowed" }, { status: 403, headers: cors });
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

const SUGGESTION_MAX_BYTES = 96 * 1024;
const SUGGESTION_STATUSES = new Set(["pending", "approved", "rejected"]);

function requestOriginAllowed(request, env) {
  const origin = request.headers.get("origin") || "";
  return Boolean(origin && corsHeaders(request, env)["access-control-allow-origin"] === origin);
}

async function readJsonBody(request, maxBytes = SUGGESTION_MAX_BYTES) {
  const declared = Number.parseInt(request.headers.get("content-length") || "0", 10);
  if (declared > maxBytes) return { error: "payload_too_large" };
  let text;
  try {
    text = await request.text();
  } catch (_) {
    return { error: "invalid_payload" };
  }
  if (new TextEncoder().encode(text).byteLength > maxBytes) return { error: "payload_too_large" };
  try {
    return { value: JSON.parse(text) };
  } catch (_) {
    return { error: "invalid_payload" };
  }
}

function isSlot(value) {
  return value === null || (typeof value === "string" && value.length > 0 && value.length <= 240);
}

function exactArray(value, length, validator) {
  return Array.isArray(value) && value.length === length && value.every(validator);
}

function cleanSlots(value) {
  return value.map((slot) => slot === null ? null : String(slot));
}

function cleanKeys(value) {
  return value.map((key) => String(key));
}

function emptySlotNotes() {
  return {
    mobilePages: Array.from({ length: 2 }, () => Array(8).fill("")),
    pc: Array.from({ length: 2 }, () => Array(8).fill("")),
    functions: Array(4).fill(""),
  };
}

function cleanSlotNotes(value) {
  return value.map((note) => String(note).trim());
}

function safeRelativeAsset(value) {
  if (!value) return true;
  const text = String(value);
  return text.length <= 400 &&
    !text.startsWith("/") &&
    !text.includes("..") &&
    !text.includes("\\") &&
    !/^[a-z][a-z0-9+.-]*:/i.test(text) &&
    !/[\u0000-\u001f]/.test(text);
}

function validateSuggestionBody(body) {
  if (!body || typeof body !== "object" || Number(body.schema_version) !== 2) return { error: "invalid_payload" };
  const jobCode = String(body.job_code || "").trim();
  const jobName = String(body.job_name || "").trim();
  if (!/^[A-Za-z0-9_]{1,80}$/.test(jobCode) || !jobName || jobName.length > 100) return { error: "invalid_payload" };
  if (String(body.submitter_name || "").length > 40 || String(body.message || "").length > 500) return { error: "invalid_payload" };
  if (String(body.website || "")) return { error: "invalid_payload" };

  const config = body.config;
  if (!config || typeof config !== "object") return { error: "invalid_payload" };
  if (!exactArray(config.mobilePages, 2, (page) => exactArray(page, 8, isSlot))) return { error: "invalid_payload" };
  if (!exactArray(config.combos, 8, (group) => exactArray(group, 8, isSlot))) return { error: "invalid_payload" };
  if (!exactArray(config.pc, 2, (page) => exactArray(page, 8, isSlot))) return { error: "invalid_payload" };
  if (!exactArray(config.functions, 4, isSlot)) return { error: "invalid_payload" };
  if (!exactArray(config.comboMeta, 8, (meta) => {
    return meta && typeof meta === "object" &&
      typeof meta.name === "string" && meta.name.length <= 32 &&
      typeof meta.description === "string" && meta.description.length <= 300;
  })) return { error: "invalid_payload" };
  if (!config.keys || typeof config.keys !== "object") return { error: "invalid_payload" };
  const isKey = (key) => typeof key === "string" && key.length <= 20;
  if (!exactArray(config.keys.mobile, 8, isKey) ||
      !exactArray(config.keys.pc, 2, (page) => exactArray(page, 8, isKey)) ||
      !exactArray(config.keys.functions, 4, isKey)) return { error: "invalid_payload" };

  const isSlotNote = (note) => typeof note === "string" && note.length <= 300;
  let slotNotes = emptySlotNotes();
  if (config.slotNotes !== undefined) {
    if (!config.slotNotes || typeof config.slotNotes !== "object" ||
        !exactArray(config.slotNotes.mobilePages, 2, (page) => exactArray(page, 8, isSlotNote)) ||
        !exactArray(config.slotNotes.pc, 2, (page) => exactArray(page, 8, isSlotNote)) ||
        !exactArray(config.slotNotes.functions, 4, isSlotNote)) return { error: "invalid_payload" };
    slotNotes = {
      mobilePages: config.slotNotes.mobilePages.map(cleanSlotNotes),
      pc: config.slotNotes.pc.map(cleanSlotNotes),
      functions: cleanSlotNotes(config.slotNotes.functions),
    };
  }

  let jobGuide = { description: "" };
  if (config.jobGuide !== undefined) {
    if (!config.jobGuide || typeof config.jobGuide !== "object" ||
        typeof config.jobGuide.description !== "string" ||
        config.jobGuide.description.length > 2000) return { error: "invalid_payload" };
    jobGuide = { description: config.jobGuide.description.trim() };
  }

  const cleanConfig = {
    schemaVersion: 2,
    mobilePages: config.mobilePages.map(cleanSlots),
    combos: config.combos.map(cleanSlots),
    comboMeta: config.comboMeta.map((meta, index) => ({
      name: String(meta.name || `${index + 1} 號自訂`),
      description: String(meta.description || ""),
    })),
    pc: config.pc.map(cleanSlots),
    functions: cleanSlots(config.functions),
    keys: {
      mobile: cleanKeys(config.keys.mobile),
      pc: config.keys.pc.map(cleanKeys),
      functions: cleanKeys(config.keys.functions),
    },
    slotNotes,
    jobGuide,
  };

  // The mobile gamepad and PC quick-slot pages are two views of the same
  // assignments. Keep one canonical mapping even for hand-written or older
  // payloads that contain only one side, and mirror per-slot notes with it.
  for (let page = 0; page < 2; page += 1) {
    for (let mobileIndex = 0; mobileIndex < 8; mobileIndex += 1) {
      const pcIndex = MOBILE_TO_PC[mobileIndex];
      const assignment = cleanConfig.mobilePages[page][mobileIndex] ?? cleanConfig.pc[page][pcIndex] ?? null;
      const note = cleanConfig.slotNotes.mobilePages[page][mobileIndex] || cleanConfig.slotNotes.pc[page][pcIndex] || "";
      cleanConfig.mobilePages[page][mobileIndex] = assignment;
      cleanConfig.pc[page][pcIndex] = assignment;
      cleanConfig.slotNotes.mobilePages[page][mobileIndex] = note;
      cleanConfig.slotNotes.pc[page][pcIndex] = note;
    }
  }
  cleanConfig.keys.mobile = MOBILE_TO_PC.map((pcIndex) => cleanConfig.keys.pc[0][pcIndex]);

  const usedIds = new Set([
    ...cleanConfig.mobilePages.flat(),
    ...cleanConfig.combos.flat(),
    ...cleanConfig.pc.flat(),
    ...cleanConfig.functions,
  ].filter(Boolean));
  const catalog = body.skill_catalog;
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) return { error: "invalid_payload" };
  const entries = Object.entries(catalog);
  if (entries.length > 200) return { error: "invalid_payload" };
  const cleanCatalog = Object.create(null);
  for (const [id, skill] of entries) {
    if (!isSlot(id) || !skill || typeof skill !== "object") return { error: "invalid_payload" };
    const name = String(skill.name || "");
    const icon = String(skill.icon || "");
    const type = String(skill.type || "");
    const stage = String(skill.stage || "");
    if (!name || name.length > 120 || type.length > 20 || stage.length > 40 || !safeRelativeAsset(icon)) return { error: "invalid_payload" };
    cleanCatalog[id] = { name, icon, type, stage };
  }
  for (const id of usedIds) {
    if (!Object.prototype.hasOwnProperty.call(cleanCatalog, id)) return { error: "invalid_payload" };
  }

  return {
    value: {
      jobCode,
      jobName,
      submitterName: String(body.submitter_name || "").trim(),
      message: String(body.message || "").trim(),
      config: cleanConfig,
      catalog: cleanCatalog,
    },
  };
}

function parseStoredJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function suggestionIdempotencyKey(request, body) {
  const headerValue = String(request.headers.get("idempotency-key") || "").trim();
  const bodyValue = String(body?.idempotency_key || "").trim();
  if (headerValue && bodyValue && headerValue !== bodyValue) return { error: "idempotency_key_mismatch" };
  const value = headerValue || bodyValue;
  if (!value) return { value: null };
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(value)) return { error: "invalid_idempotency_key" };
  return { value };
}

async function idempotentSuggestionResponse(env, key, payloadHash, cors) {
  const existing = await env.DB.prepare(
    `SELECT id, status, payload_hash
       FROM skill_suggestions
      WHERE idempotency_key = ?`
  ).bind(key).first();
  if (!existing) return null;
  if (existing.payload_hash && existing.payload_hash !== payloadHash) {
    return json({ ok: false, error: "idempotency_conflict" }, { status: 409, headers: cors });
  }
  return json({
    ok: true,
    id: existing.id,
    status: existing.status,
    idempotent_replay: true,
  }, { headers: cors });
}

async function submitSkillSuggestion(request, env) {
  const cors = corsHeaders(request, env);
  if (!requestOriginAllowed(request, env)) {
    return json({ ok: false, error: "origin_not_allowed" }, { status: 403, headers: cors });
  }
  const parsed = await readJsonBody(request);
  if (parsed.error) return json({ ok: false, error: parsed.error }, { status: 400, headers: cors });
  const checked = validateSuggestionBody(parsed.value);
  if (checked.error) return json({ ok: false, error: checked.error }, { status: 400, headers: cors });

  const keyResult = suggestionIdempotencyKey(request, parsed.value);
  if (keyResult.error) return json({ ok: false, error: keyResult.error }, { status: 400, headers: cors });
  const idempotencyKey = keyResult.value;
  const suggestion = checked.value;
  const payloadHash = idempotencyKey ? await sha256(JSON.stringify(suggestion)) : null;
  if (idempotencyKey) {
    const replay = await idempotentSuggestionResponse(env, idempotencyKey, payloadHash, cors);
    if (replay) return replay;
  }

  const ip = clientIp(request);
  const ipHash = ip ? await sha256(`${env.IP_HASH_SALT || ""}:${ip}`) : "";
  if (ipHash) {
    const recent = await env.DB.prepare(
      `SELECT COUNT(*) AS total
         FROM skill_suggestions
        WHERE ip_hash = ?
          AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')`
    ).bind(ipHash).first();
    if (Number(recent?.total || 0) >= 5) {
      return json({ ok: false, error: "rate_limited" }, { status: 429, headers: cors });
    }
  }

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO skill_suggestions (
        id, status, job_code, job_name, submitter_name, message,
        config_json, catalog_json, ip_hash, user_agent,
        idempotency_key, payload_hash
      ) VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      suggestion.jobCode,
      suggestion.jobName,
      shortText(suggestion.submitterName, 40) || null,
      shortText(suggestion.message, 500) || null,
      JSON.stringify(suggestion.config),
      JSON.stringify(suggestion.catalog),
      shortText(ipHash, 128) || null,
      shortText(request.headers.get("user-agent") || "", 600) || null,
      idempotencyKey,
      payloadHash
    ).run();
  } catch (error) {
    // Concurrent retries can both pass the initial lookup. The unique index
    // makes one insert win; return that row for the other request.
    if (idempotencyKey) {
      const replay = await idempotentSuggestionResponse(env, idempotencyKey, payloadHash, cors);
      if (replay) return replay;
    }
    throw error;
  }

  return json({ ok: true, id, status: "pending" }, { status: 201, headers: cors });
}

async function publicSkillDefault(request, env) {
  const cors = corsHeaders(request, env);
  const url = new URL(request.url);
  const jobCode = String(url.searchParams.get("job_code") || "").trim();
  if (!/^[A-Za-z0-9_]{1,80}$/.test(jobCode)) {
    return json({ ok: false, error: "invalid_job_code" }, { status: 400, headers: cors });
  }
  const row = await env.DB.prepare(
    `SELECT job_code, job_name, suggestion_id, config_json, catalog_json, updated_at
       FROM skill_defaults
      WHERE job_code = ?`
  ).bind(jobCode).first();
  if (!row) return json({ ok: true, default: null }, { headers: cors });
  return json({
    ok: true,
    default: {
      job_code: row.job_code,
      job_name: row.job_name,
      suggestion_id: row.suggestion_id,
      updated_at: row.updated_at,
      config: parseStoredJson(row.config_json, null),
      skill_catalog: parseStoredJson(row.catalog_json, {}),
    },
  }, { headers: cors });
}

function encodeSuggestionCursor(createdAt, id) {
  return btoa(`${createdAt}\n${id}`)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeSuggestionCursor(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return { value: null };
  if (raw.length > 240 || !/^[A-Za-z0-9_-]+$/.test(raw)) return { error: "invalid_cursor" };
  try {
    const base64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    const separator = decoded.indexOf("\n");
    const createdAt = decoded.slice(0, separator);
    const id = decoded.slice(separator + 1);
    if (separator < 1 || createdAt.length > 64 || !/^[A-Za-z0-9-]{1,100}$/.test(id)) {
      return { error: "invalid_cursor" };
    }
    return { value: { createdAt, id } };
  } catch (_) {
    return { error: "invalid_cursor" };
  }
}

async function adminSkillSuggestions(request, env) {
  const cors = corsHeaders(request, env);
  if (!authorized(request, env)) return json({ ok: false, error: "unauthorized" }, { status: 401, headers: cors });
  const url = new URL(request.url);
  const status = String(url.searchParams.get("status") || "pending");
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") || "100", 10);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 200)) : 100;
  const cursor = decodeSuggestionCursor(url.searchParams.get("cursor"));
  if (cursor.error) return json({ ok: false, error: cursor.error }, { status: 400, headers: cors });
  let query = `SELECT id, created_at, updated_at, status, job_code, job_name,
                      submitter_name, message, reviewed_at, admin_note
                 FROM skill_suggestions`;
  let statement;
  const pageSize = limit + 1;
  if (SUGGESTION_STATUSES.has(status) && cursor.value) {
    statement = env.DB.prepare(`${query}
      WHERE status = ? AND (created_at < ? OR (created_at = ? AND id < ?))
      ORDER BY created_at DESC, id DESC LIMIT ?`)
      .bind(status, cursor.value.createdAt, cursor.value.createdAt, cursor.value.id, pageSize);
  } else if (SUGGESTION_STATUSES.has(status)) {
    statement = env.DB.prepare(`${query} WHERE status = ? ORDER BY created_at DESC, id DESC LIMIT ?`).bind(status, pageSize);
  } else if (cursor.value) {
    statement = env.DB.prepare(`${query}
      WHERE created_at < ? OR (created_at = ? AND id < ?)
      ORDER BY created_at DESC, id DESC LIMIT ?`)
      .bind(cursor.value.createdAt, cursor.value.createdAt, cursor.value.id, pageSize);
  } else {
    statement = env.DB.prepare(`${query} ORDER BY created_at DESC, id DESC LIMIT ?`).bind(pageSize);
  }
  const { results } = await statement.all();
  const rows = results || [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return json({
    ok: true,
    results: page,
    next_cursor: hasMore && last ? encodeSuggestionCursor(last.created_at, last.id) : null,
  }, { headers: cors });
}

async function adminSkillSuggestionDetail(request, env, id) {
  const cors = corsHeaders(request, env);
  if (!authorized(request, env)) return json({ ok: false, error: "unauthorized" }, { status: 401, headers: cors });
  const row = await env.DB.prepare(
    `SELECT id, created_at, updated_at, status, job_code, job_name,
            submitter_name, message, config_json, catalog_json,
            reviewed_at, admin_note
       FROM skill_suggestions
      WHERE id = ?`
  ).bind(id).first();
  if (!row) return json({ ok: false, error: "not_found" }, { status: 404, headers: cors });
  return json({
    ok: true,
    suggestion: {
      ...row,
      config: parseStoredJson(row.config_json, null),
      skill_catalog: parseStoredJson(row.catalog_json, {}),
      config_json: undefined,
      catalog_json: undefined,
    },
  }, { headers: cors });
}

async function reviewSkillSuggestion(request, env, id) {
  const cors = corsHeaders(request, env);
  if (!authorized(request, env)) return json({ ok: false, error: "unauthorized" }, { status: 401, headers: cors });
  const parsed = await readJsonBody(request, 8 * 1024);
  if (parsed.error) return json({ ok: false, error: parsed.error }, { status: 400, headers: cors });
  const decision = String(parsed.value?.decision || "");
  const applyDefault = decision === "approve" && Boolean(parsed.value?.apply_default);
  const adminNote = String(parsed.value?.admin_note || "").trim();
  if (!["approve", "reject"].includes(decision) || adminNote.length > 500) {
    return json({ ok: false, error: "invalid_payload" }, { status: 400, headers: cors });
  }
  const row = await env.DB.prepare(
    `SELECT id, job_code, job_name, config_json, catalog_json
       FROM skill_suggestions
      WHERE id = ?`
  ).bind(id).first();
  if (!row) return json({ ok: false, error: "not_found" }, { status: 404, headers: cors });
  const status = decision === "approve" ? "approved" : "rejected";
  const update = env.DB.prepare(
    `UPDATE skill_suggestions
        SET status = ?, admin_note = ?, reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?`
  ).bind(status, adminNote || null, id);

  let unpublishedDefault = false;
  if (applyDefault) {
    const upsert = env.DB.prepare(
      `INSERT INTO skill_defaults (job_code, job_name, suggestion_id, config_json, catalog_json)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(job_code) DO UPDATE SET
         job_name = excluded.job_name,
         suggestion_id = excluded.suggestion_id,
         config_json = excluded.config_json,
         catalog_json = excluded.catalog_json,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
    ).bind(row.job_code, row.job_name, row.id, row.config_json, row.catalog_json);
    await env.DB.batch([update, upsert]);
  } else if (decision === "reject") {
    const currentDefault = await env.DB.prepare(
      `SELECT job_code FROM skill_defaults WHERE suggestion_id = ?`
    ).bind(id).first();
    const unpublish = env.DB.prepare(
      `DELETE FROM skill_defaults WHERE suggestion_id = ?`
    ).bind(id);
    await env.DB.batch([update, unpublish]);
    unpublishedDefault = Boolean(currentDefault);
  } else {
    await update.run();
  }
  return json({
    ok: true,
    id,
    status,
    applied_default: applyDefault,
    unpublished_default: unpublishedDefault,
  }, { headers: cors });
}

async function adminSkillDefaults(request, env) {
  const cors = corsHeaders(request, env);
  if (!authorized(request, env)) return json({ ok: false, error: "unauthorized" }, { status: 401, headers: cors });
  const { results } = await env.DB.prepare(
    `SELECT job_code, job_name, suggestion_id, updated_at
       FROM skill_defaults
      ORDER BY updated_at DESC`
  ).all();
  return json({ ok: true, results: results || [] }, { headers: cors });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env, url.pathname === "/collect") });
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
    if (url.pathname === "/skill-suggestions" && request.method === "POST") {
      return submitSkillSuggestion(request, env);
    }
    if (url.pathname === "/skill-defaults" && request.method === "GET") {
      return publicSkillDefault(request, env);
    }
    if (url.pathname === "/admin/skill-suggestions" && request.method === "GET") {
      return adminSkillSuggestions(request, env);
    }
    const reviewMatch = url.pathname.match(/^\/admin\/skill-suggestions\/([A-Za-z0-9-]+)\/review$/);
    if (reviewMatch && request.method === "POST") {
      return reviewSkillSuggestion(request, env, reviewMatch[1]);
    }
    const detailMatch = url.pathname.match(/^\/admin\/skill-suggestions\/([A-Za-z0-9-]+)$/);
    if (detailMatch && request.method === "GET") {
      return adminSkillSuggestionDetail(request, env, detailMatch[1]);
    }
    if (url.pathname === "/admin/skill-defaults" && request.method === "GET") {
      return adminSkillDefaults(request, env);
    }
    return json({ ok: false, error: "not_found" }, { status: 404, headers: corsHeaders(request, env) });
  },
};
