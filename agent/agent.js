#!/usr/bin/env node
"use strict";

/**
 * Simple Alarm 自宅PCエージェント
 *
 * 中継サーバーへ「外向き」に接続し、届いたコマンドを実行する。
 * 自宅のルーターにポート開放をする必要はない。
 *
 * 依存ゼロ（Node.js 標準モジュールのみ）。
 *
 *   RELAY_URL=https://your-relay.example.com \
 *   ALARM_TOKEN=<中継サーバーと同じトークン> \
 *   node agent/agent.js
 *
 * 実行できる「作業」は agent/tasks.json に自分で書いたものだけ。
 * リモートから送れるのはタスクの id だけで、コマンド文字列は送れない。
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { URL } = require("url");

const RELAY_URL = String(process.env.RELAY_URL || "http://localhost:8787");
const TOKEN = String(process.env.ALARM_TOKEN || "");
const TASKS_FILE = process.env.TASKS_FILE || path.join(__dirname, "tasks.json");
const EXAMPLE_TASKS_FILE = path.join(__dirname, "tasks.example.json");

const BEEP_INTERVAL_MS = 1200;
const MAX_EVENT_BUFFER = 256 * 1024;
const DEFAULT_TASK_TIMEOUT_MS = 60_000;
const MAX_CONCURRENT_TASKS = 4;
const OUTPUT_LIMIT = 4000;

if (TOKEN.length < 16) {
  console.error("[agent] 環境変数 ALARM_TOKEN に中継サーバーと同じトークン（16文字以上）を設定してください。");
  process.exit(1);
}

const PLATFORM = process.platform;

/* ------------------------------------------------------------------ *
 * タスク定義の読み込み
 * ------------------------------------------------------------------ */

function loadTasks() {
  let file = TASKS_FILE;
  if (!fs.existsSync(file)) {
    console.warn(`[agent] ${TASKS_FILE} が無いので ${path.basename(EXAMPLE_TASKS_FILE)} を使います。`);
    console.warn("[agent] 自分用の作業を登録するには tasks.example.json をコピーして tasks.json を作ってください。");
    file = EXAMPLE_TASKS_FILE;
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`[agent] ${file} を読めませんでした: ${e.message}`);
    return [];
  }

  const raw = Array.isArray(parsed) ? parsed : parsed.tasks;
  if (!Array.isArray(raw)) {
    console.error(`[agent] ${file}: tasks 配列が見つかりません。`);
    return [];
  }

  const tasks = [];
  const seen = new Set();
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    if (typeof t.id !== "string" || !t.id) {
      console.warn("[agent] id の無いタスクを飛ばしました。");
      continue;
    }
    if (typeof t.command !== "string" || !t.command) {
      console.warn(`[agent] タスク ${t.id}: command が文字列ではありません。飛ばします。`);
      continue;
    }
    if (t.args !== undefined && (!Array.isArray(t.args) || t.args.some((a) => typeof a !== "string"))) {
      console.warn(`[agent] タスク ${t.id}: args は文字列の配列にしてください。飛ばします。`);
      continue;
    }
    // platform 指定があれば、このOS用のものだけ採用する
    if (t.platform) {
      const list = Array.isArray(t.platform) ? t.platform : [t.platform];
      if (!list.includes(PLATFORM)) continue;
    }
    if (seen.has(t.id)) {
      console.warn(`[agent] タスク id が重複しています: ${t.id}。後の方を飛ばします。`);
      continue;
    }
    seen.add(t.id);
    tasks.push({
      id: t.id,
      label: typeof t.label === "string" && t.label ? t.label : t.id,
      command: t.command,
      args: t.args ? t.args.slice() : [],
      timeoutMs: Number.isFinite(t.timeoutMs) ? Math.min(Math.max(t.timeoutMs, 1000), 600_000) : DEFAULT_TASK_TIMEOUT_MS,
    });
  }
  return tasks;
}

let tasks = loadTasks();

/* ------------------------------------------------------------------ *
 * 状態
 * ------------------------------------------------------------------ */

const state = {
  pc: { hostname: os.hostname(), platform: PLATFORM },
  alarm: { time: null, ringing: false },
  tasks: tasks.map((t) => ({ id: t.id, label: t.label })),
  lastTask: null,
  updatedAt: 0,
};

let lastFiredKey = null;
let beepTimer = null;
let runningTasks = 0;

/* ------------------------------------------------------------------ *
 * OS 操作（音・通知）
 * ------------------------------------------------------------------ */

function run(command, args, timeoutMs = 15_000) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        resolve({ ok: !err, code: err?.code ?? 0, stdout: stdout || "", stderr: stderr || "", error: err ? err.message : null });
      }
    );
  });
}

const SOUND_CANDIDATES = {
  darwin: [["afplay", ["/System/Library/Sounds/Sosumi.aiff"]]],
  win32: [["powershell", ["-NoProfile", "-Command", "[console]::beep(880,400)"]]],
  linux: [
    ["paplay", ["/usr/share/sounds/freedesktop/stereo/alarm-clock-elapsed.oga"]],
    ["paplay", ["/usr/share/sounds/freedesktop/stereo/complete.oga"]],
    ["aplay", ["-q", "/usr/share/sounds/alsa/Front_Center.wav"]],
  ],
};

let soundChoice; // 一度成功した鳴らし方を覚える。null = 手段なし。

async function playAlarmSound() {
  if (soundChoice === null) {
    process.stdout.write("\x07"); // 端末ベルへフォールバック
    return;
  }
  if (soundChoice) {
    const r = await run(soundChoice[0], soundChoice[1], 10_000);
    if (!r.ok) soundChoice = undefined; // 次回は探し直す
    return;
  }
  for (const cand of SOUND_CANDIDATES[PLATFORM] || []) {
    const r = await run(cand[0], cand[1], 10_000);
    if (r.ok) {
      soundChoice = cand;
      return;
    }
  }
  soundChoice = null;
  console.warn("[agent] 音を鳴らすコマンドが見つかりませんでした。端末のベルで代用します。");
  process.stdout.write("\x07");
}

async function notify(title, message) {
  try {
    if (PLATFORM === "darwin") {
      const esc = (s) => s.replace(/["\\]/g, "\\$&");
      await run("osascript", ["-e", `display notification "${esc(message)}" with title "${esc(title)}"`]);
    } else if (PLATFORM === "linux") {
      await run("notify-send", [title, message]);
    } else if (PLATFORM === "win32") {
      const esc = (s) => s.replace(/'/g, "''");
      await run("powershell", [
        "-NoProfile",
        "-Command",
        "Add-Type -AssemblyName System.Windows.Forms;" +
          "$n=New-Object System.Windows.Forms.NotifyIcon;" +
          "$n.Icon=[System.Drawing.SystemIcons]::Information;" +
          "$n.Visible=$true;" +
          `$n.ShowBalloonTip(5000,'${esc(title)}','${esc(message)}',[System.Windows.Forms.ToolTipIcon]::Info);` +
          "Start-Sleep -Seconds 6;$n.Dispose()",
      ]);
    }
  } catch {
    /* 通知は出せなくても致命的ではない */
  }
}

/* ------------------------------------------------------------------ *
 * アラーム
 * ------------------------------------------------------------------ */

const pad = (n) => String(n).padStart(2, "0");

function tick() {
  if (!state.alarm.time || state.alarm.ringing) return;
  const now = new Date();
  const cur = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const key = `${now.toDateString()} ${cur}`;
  if (cur === state.alarm.time && lastFiredKey !== key) {
    lastFiredKey = key;
    startRing();
  }
}

function startRing() {
  if (state.alarm.ringing) return;
  state.alarm.ringing = true;
  console.log(`[agent] ⏰ アラーム発火 (${state.alarm.time})`);
  publishState();
  playAlarmSound();
  notify("Simple Alarm", `⏰ ${state.alarm.time} のアラームです`);
  beepTimer = setInterval(playAlarmSound, BEEP_INTERVAL_MS);
}

function stopRing() {
  if (beepTimer) {
    clearInterval(beepTimer);
    beepTimer = null;
  }
  if (!state.alarm.ringing) return;
  state.alarm.ringing = false;
  console.log("[agent] アラーム停止");
  publishState();
}

/* ------------------------------------------------------------------ *
 * タスク実行
 * ------------------------------------------------------------------ */

function truncate(s) {
  const t = String(s).trim();
  return t.length > OUTPUT_LIMIT ? `${t.slice(0, OUTPUT_LIMIT)}\n…(以下省略)` : t;
}

async function runTask(id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) {
    state.lastTask = { id, label: id, ok: false, output: "そのタスクは登録されていません。", finishedAt: Date.now() };
    publishState();
    return;
  }
  if (runningTasks >= MAX_CONCURRENT_TASKS) {
    state.lastTask = { id, label: task.label, ok: false, output: "同時に実行できるタスク数の上限に達しています。", finishedAt: Date.now() };
    publishState();
    return;
  }

  runningTasks++;
  state.lastTask = { id: task.id, label: task.label, running: true, startedAt: Date.now() };
  publishState();
  console.log(`[agent] タスク実行: ${task.label} (${task.id})`);

  // シェルを介さず execFile で実行するため、引数が解釈されて別のコマンドになることはない
  const r = await run(task.command, task.args, task.timeoutMs);
  runningTasks--;

  const output = truncate([r.stdout, r.stderr, r.ok ? "" : r.error].filter(Boolean).join("\n")) || (r.ok ? "(出力なし)" : "(出力なし)");
  state.lastTask = {
    id: task.id,
    label: task.label,
    ok: r.ok,
    code: r.code,
    output,
    finishedAt: Date.now(),
  };
  console.log(`[agent] タスク完了: ${task.label} → ${r.ok ? "成功" : `失敗 (${r.error})`}`);
  publishState();
}

/* ------------------------------------------------------------------ *
 * コマンド処理
 * ------------------------------------------------------------------ */

function handleCommand(cmd) {
  const payload = cmd.payload || {};
  switch (cmd.type) {
    case "alarm.set": {
      const time = String(payload.time || "");
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
        console.warn(`[agent] 不正な時刻を無視しました: ${JSON.stringify(payload.time)}`);
        return;
      }
      state.alarm.time = time;
      // 今まさにその分だった場合に即発火しないよう、この分は発火済み扱いにする
      // （ブラウザ側のローカルモードと挙動を揃える）
      const now = new Date();
      const cur = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      lastFiredKey = cur === time ? `${now.toDateString()} ${cur}` : null;
      stopRing();
      console.log(`[agent] アラームをセット: ${time}`);
      publishState();
      break;
    }
    case "alarm.clear":
      state.alarm.time = null;
      lastFiredKey = null;
      stopRing();
      console.log("[agent] アラームを解除");
      publishState();
      break;
    case "alarm.stop":
      stopRing();
      break;
    case "alarm.test":
      startRing();
      break;
    case "task.run":
      runTask(String(payload.id || ""));
      break;
    case "tasks.reload":
      tasks = loadTasks();
      state.tasks = tasks.map((t) => ({ id: t.id, label: t.label }));
      console.log(`[agent] タスクを再読み込み (${tasks.length} 件)`);
      publishState();
      break;
    case "ping":
      publishState();
      break;
    default:
      console.warn(`[agent] 未知のコマンド: ${cmd.type}`);
  }
}

/* ------------------------------------------------------------------ *
 * 中継サーバーとの通信
 * ------------------------------------------------------------------ */

const relay = new URL(RELAY_URL);
const transport = relay.protocol === "https:" ? https : http;

function publishState() {
  state.updatedAt = Date.now();
  const body = JSON.stringify(state);
  const req = transport.request(
    new URL("/api/state", relay),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        Authorization: `Bearer ${TOKEN}`,
      },
      timeout: 10_000,
    },
    (res) => {
      res.resume();
      if (res.statusCode !== 200) console.warn(`[agent] 状態の送信に失敗: HTTP ${res.statusCode}`);
    }
  );
  req.on("timeout", () => req.destroy(new Error("timeout")));
  req.on("error", (e) => console.warn(`[agent] 状態の送信に失敗: ${e.message}`));
  req.end(body);
}

let backoffMs = 1000;
let connected = false;

function connect() {
  const url = new URL("/api/events", relay);
  url.searchParams.set("role", "pc");

  const req = transport.request(
    url,
    {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${TOKEN}`,
        "Cache-Control": "no-cache",
      },
    },
    (res) => {
      if (res.statusCode !== 200) {
        console.error(`[agent] 中継サーバーに接続できません: HTTP ${res.statusCode}` + (res.statusCode === 401 ? "（トークンが一致していません）" : ""));
        res.resume();
        scheduleReconnect();
        return;
      }

      connected = true;
      backoffMs = 1000;
      console.log(`[agent] 中継サーバーに接続しました: ${relay.origin}`);
      publishState();

      let buffer = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          processEventBlock(raw);
        }
        if (buffer.length > MAX_EVENT_BUFFER) {
          console.warn("[agent] 受信バッファが大きすぎるため破棄しました。");
          buffer = "";
        }
      });
      res.on("end", () => {
        connected = false;
        console.warn("[agent] 接続が切れました。");
        scheduleReconnect();
      });
      res.on("error", (e) => {
        connected = false;
        console.warn(`[agent] 受信エラー: ${e.message}`);
        scheduleReconnect();
      });
    }
  );

  req.on("error", (e) => {
    if (connected) connected = false;
    console.warn(`[agent] 接続エラー: ${e.message}`);
    scheduleReconnect();
  });
  req.end();
}

function processEventBlock(raw) {
  let event = "message";
  const dataLines = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith(":")) continue; // ハートビート
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return;

  let data;
  try {
    data = JSON.parse(dataLines.join("\n"));
  } catch {
    return;
  }

  if (event === "command") handleCommand(data);
  else if (event === "hello") console.log(`[agent] 接続確立 (id=${data.id})`);
}

let reconnectTimer = null;
function scheduleReconnect() {
  if (reconnectTimer) return;
  const wait = backoffMs;
  backoffMs = Math.min(backoffMs * 2, 30_000);
  console.log(`[agent] ${Math.round(wait / 1000)} 秒後に再接続します。`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, wait);
}

/* ------------------------------------------------------------------ *
 * 起動
 * ------------------------------------------------------------------ */

console.log(`[agent] ${state.pc.hostname} (${PLATFORM}) / 登録タスク ${tasks.length} 件`);
for (const t of tasks) console.log(`[agent]   - ${t.id}: ${t.label}`);

setInterval(tick, 1000);
// 数分に一度は状態を送り、中継サーバー側のキャッシュを新鮮に保つ
setInterval(publishState, 60_000).unref?.();
connect();

function shutdown() {
  console.log("\n[agent] 終了します");
  stopRing();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
