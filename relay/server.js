#!/usr/bin/env node
"use strict";

/**
 * Simple Alarm 中継サーバー
 *
 * 自宅PC上のエージェント（agent/agent.js）と、外出先のブラウザ（index.html）の
 * 間を仲介するだけの薄いサーバー。状態はメモリ上にしか持たない。
 *
 * 依存ゼロ（Node.js 標準モジュールのみ）。
 *
 *   ALARM_TOKEN=<16文字以上の秘密トークン> node relay/server.js
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 8787);
const TOKEN = String(process.env.ALARM_TOKEN || "");
const MAX_BODY = 64 * 1024;
const HEARTBEAT_MS = 25000;
const AUTH_FAIL_LIMIT = 10;
const AUTH_FAIL_WINDOW_MS = 60 * 1000;

const INDEX_PATH = path.join(__dirname, "..", "index.html");

if (TOKEN.length < 16) {
  console.error("[relay] 環境変数 ALARM_TOKEN に 16 文字以上の秘密トークンを設定してください。");
  console.error("[relay] 生成例: node -e \"console.log(require('crypto').randomBytes(24).toString('base64url'))\"");
  process.exit(1);
}

/** @type {Map<number, {id:number, role:string, res:import('http').ServerResponse}>} */
const clients = new Map();
let nextClientId = 1;

/** 自宅PCが最後に報告した状態。新しく繋いだ端末へ即座に配る。 */
let lastState = null;

/** 認証失敗の簡易スロットリング（IP単位） */
const authFails = new Map();

function presence() {
  let pc = 0;
  let phone = 0;
  for (const c of clients.values()) {
    if (c.role === "pc") pc++;
    else phone++;
  }
  return { pc, phone };
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...corsHeaders(),
  });
  res.end(body);
}

function sendEvent(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    /* 切断済み。close ハンドラが後始末する。 */
  }
}

function broadcast(role, event, data) {
  let n = 0;
  for (const c of clients.values()) {
    if (c.role === role) {
      sendEvent(c.res, event, data);
      n++;
    }
  }
  return n;
}

function broadcastPresence() {
  const p = presence();
  for (const c of clients.values()) sendEvent(c.res, "presence", p);
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    // 長さが違っても比較時間を揃える
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function throttled(ip) {
  const rec = authFails.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > AUTH_FAIL_WINDOW_MS) {
    authFails.delete(ip);
    return false;
  }
  return rec.count >= AUTH_FAIL_LIMIT;
}

function noteAuthFail(ip) {
  const rec = authFails.get(ip);
  if (!rec || Date.now() - rec.first > AUTH_FAIL_WINDOW_MS) {
    authFails.set(ip, { count: 1, first: Date.now() });
  } else {
    rec.count++;
  }
}

function extractToken(req, url) {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }
  // EventSource は独自ヘッダを付けられないためクエリも受ける
  return url.searchParams.get("token") || "";
}

function authorize(req, res, url) {
  const ip = clientIp(req);
  if (throttled(ip)) {
    sendJson(res, 429, { error: "too_many_attempts" });
    return false;
  }
  if (!safeEqual(extractToken(req, url), TOKEN)) {
    noteAuthFail(ip);
    sendJson(res, 401, { error: "unauthorized" });
    return false;
  }
  authFails.delete(ip);
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function serveIndex(res) {
  fs.readFile(INDEX_PATH, (err, buf) => {
    if (err) {
      sendJson(res, 404, { error: "index_not_found", path: INDEX_PATH });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": buf.length,
      "Cache-Control": "no-cache",
    });
    res.end(buf);
  });
}

function handleEvents(req, res, url) {
  const role = url.searchParams.get("role") === "pc" ? "pc" : "phone";

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // リバースプロキシ（nginx 等）でのバッファリングを抑止
    "X-Accel-Buffering": "no",
    ...corsHeaders(),
  });

  const id = nextClientId++;
  const client = { id, role, res };
  clients.set(id, client);

  sendEvent(res, "hello", { id, role, presence: presence() });
  if (role === "phone" && lastState) sendEvent(res, "state", lastState);
  broadcastPresence();

  console.log(`[relay] ${role} 接続 (id=${id}) ${JSON.stringify(presence())}`);

  const cleanup = () => {
    if (!clients.has(id)) return;
    clients.delete(id);
    console.log(`[relay] ${role} 切断 (id=${id}) ${JSON.stringify(presence())}`);
    if (role === "pc" && presence().pc === 0) {
      lastState = null;
      broadcast("phone", "state", null);
    }
    broadcastPresence();
  };

  req.on("close", cleanup);
  req.on("error", cleanup);
}

async function handleCommand(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    sendJson(res, 400, { error: e.message });
    return;
  }
  if (!body || typeof body.type !== "string") {
    sendJson(res, 400, { error: "type_required" });
    return;
  }
  const delivered = broadcast("pc", "command", {
    type: body.type,
    payload: body.payload ?? null,
    at: Date.now(),
  });
  sendJson(res, 200, { ok: true, delivered });
}

async function handleState(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    sendJson(res, 400, { error: e.message });
    return;
  }
  lastState = body;
  const delivered = broadcast("phone", "state", body);
  sendJson(res, 200, { ok: true, delivered });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, ...presence() });
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    serveIndex(res);
    return;
  }

  if (url.pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    if (!authorize(req, res, url)) return;

    if (url.pathname === "/api/events" && req.method === "GET") {
      handleEvents(req, res, url);
      return;
    }
    if (url.pathname === "/api/command" && req.method === "POST") {
      handleCommand(req, res);
      return;
    }
    if (url.pathname === "/api/state" && req.method === "POST") {
      handleState(req, res);
      return;
    }
  }

  sendJson(res, 404, { error: "not_found" });
});

// SSE 接続をアイドルタイムアウトで切られないようにする
server.timeout = 0;
server.keepAliveTimeout = 0;
server.headersTimeout = 0;

const heartbeat = setInterval(() => {
  for (const c of clients.values()) {
    try {
      c.res.write(`: ping ${Date.now()}\n\n`);
    } catch {
      /* close ハンドラ側で片付く */
    }
  }
}, HEARTBEAT_MS);
heartbeat.unref?.();

server.listen(PORT, () => {
  console.log(`[relay] http://0.0.0.0:${PORT} で待機中`);
  console.log("[relay] ブラウザで開き、同じトークンを入力すると自宅PCを操作できます。");
});

function shutdown() {
  console.log("\n[relay] 終了します");
  clearInterval(heartbeat);
  for (const c of clients.values()) {
    try {
      c.res.end();
    } catch {
      /* noop */
    }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
