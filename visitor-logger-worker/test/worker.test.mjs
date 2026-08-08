import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/worker.js";

class MockStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  first() {
    return this.db.first(this);
  }

  all() {
    return this.db.all(this);
  }

  run() {
    return this.db.run(this);
  }
}

class MockDB {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.batches = [];
    this.runs = [];
  }

  prepare(sql) {
    return new MockStatement(this, sql);
  }

  first(statement) {
    return this.handlers.first?.(statement) ?? null;
  }

  all(statement) {
    return this.handlers.all?.(statement) ?? { results: [] };
  }

  run(statement) {
    this.runs.push(statement);
    return this.handlers.run?.(statement) ?? { success: true };
  }

  batch(statements) {
    this.batches.push(statements);
    return this.handlers.batch?.(statements) ?? statements.map(() => ({ success: true }));
  }
}

function env(db) {
  return {
    DB: db,
    READ_TOKEN: "test-token",
    ALLOWED_ORIGINS: "https://jc1maple.github.io",
    IP_HASH_SALT: "test-salt",
  };
}

function adminRequest(path, init = {}) {
  return new Request(`https://worker.example${path}`, {
    ...init,
    headers: {
      authorization: "Bearer test-token",
      origin: "https://jc1maple.github.io",
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
}

function emptySuggestion() {
  const page = () => Array(8).fill(null);
  const keys = (prefix) => Array.from({ length: 8 }, (_, index) => `${prefix}${index}`);
  return {
    schema_version: 2,
    job_code: "TestJob",
    job_name: "測試職業",
    submitter_name: "玩家",
    message: "測試",
    website: "",
    config: {
      mobilePages: [page(), page()],
      combos: Array.from({ length: 8 }, page),
      comboMeta: Array.from({ length: 8 }, (_, index) => ({ name: `P${index + 1}`, description: "" })),
      pc: [page(), page()],
      functions: Array(4).fill(null),
      keys: {
        mobile: keys("M"),
        pc: [keys("A"), keys("B")],
        functions: ["1", "2", "3", "4"],
      },
    },
    skill_catalog: {},
  };
}

test("rejecting a published suggestion atomically removes its default", async () => {
  const db = new MockDB({
    first(statement) {
      if (statement.sql.includes("FROM skill_suggestions")) {
        return { id: "suggestion-1", job_code: "TestJob", job_name: "測試", config_json: "{}", catalog_json: "{}" };
      }
      if (statement.sql.includes("FROM skill_defaults")) return { job_code: "TestJob" };
      return null;
    },
  });
  const response = await worker.fetch(adminRequest("/admin/skill-suggestions/suggestion-1/review", {
    method: "POST",
    body: JSON.stringify({ decision: "reject", apply_default: false, admin_note: "outdated" }),
  }), env(db));
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.status, "rejected");
  assert.equal(data.unpublished_default, true);
  assert.equal(db.batches.length, 1);
  assert.equal(db.batches[0].some((statement) => statement.sql.includes("DELETE FROM skill_defaults")), true);
});

test("submission idempotency replays an existing suggestion and detects conflicts", async () => {
  const body = JSON.stringify(emptySuggestion());
  const replayDb = new MockDB({
    first(statement) {
      if (statement.sql.includes("WHERE idempotency_key")) {
        return { id: "existing-id", status: "pending", payload_hash: null };
      }
      return null;
    },
  });
  const replay = await worker.fetch(new Request("https://worker.example/skill-suggestions", {
    method: "POST",
    body,
    headers: {
      origin: "https://jc1maple.github.io",
      "content-type": "application/json",
      "idempotency-key": "retry-key-1234",
    },
  }), env(replayDb));
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), {
    ok: true,
    id: "existing-id",
    status: "pending",
    idempotent_replay: true,
  });

  const conflictDb = new MockDB({
    first(statement) {
      if (statement.sql.includes("WHERE idempotency_key")) {
        return { id: "existing-id", status: "pending", payload_hash: "different-payload" };
      }
      return null;
    },
  });
  const conflict = await worker.fetch(new Request("https://worker.example/skill-suggestions", {
    method: "POST",
    body,
    headers: {
      origin: "https://jc1maple.github.io",
      "content-type": "application/json",
      "idempotency-key": "retry-key-1234",
    },
  }), env(conflictDb));
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error, "idempotency_conflict");
});

test("admin suggestion list returns and accepts a stable cursor", async () => {
  const rows = [
    { id: "c", created_at: "2026-08-08T03:00:00.000Z" },
    { id: "b", created_at: "2026-08-08T02:00:00.000Z" },
    { id: "a", created_at: "2026-08-08T01:00:00.000Z" },
  ];
  const firstDb = new MockDB({ all: () => ({ results: rows }) });
  const first = await worker.fetch(adminRequest("/admin/skill-suggestions?status=all&limit=2"), env(firstDb));
  const firstData = await first.json();
  assert.deepEqual(firstData.results, rows.slice(0, 2));
  assert.equal(typeof firstData.next_cursor, "string");

  let cursorBindings;
  const secondDb = new MockDB({
    all(statement) {
      cursorBindings = statement.args;
      return { results: [rows[2]] };
    },
  });
  const second = await worker.fetch(adminRequest(`/admin/skill-suggestions?status=all&limit=2&cursor=${encodeURIComponent(firstData.next_cursor)}`), env(secondDb));
  assert.equal(second.status, 200);
  assert.deepEqual(cursorBindings, [rows[1].created_at, rows[1].created_at, rows[1].id, 3]);
  assert.equal((await second.json()).next_cursor, null);
});
