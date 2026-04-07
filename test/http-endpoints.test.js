#!/usr/bin/env node
/**
 * HTTP endpoint tests for server.js
 * Starts the server as a child process and makes real HTTP requests.
 */
"use strict";

const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

const PORT = 8081; // 本番と被らないよう別ポートを使用
const BASE = `http://localhost:${PORT}`;
const SERVER = path.resolve(__dirname, "../server.js");

let passed = 0;
let failed = 0;
let serverProcess;

// ── Helpers ───────────────────────────────────────────────────────────────────

function test(name, fn) {
  return fn().then(
    () => { console.log(`  ✅ ${name}`); passed++; },
    (err) => { console.error(`  ❌ ${name}\n     ${err.message}`); failed++; }
  );
}

function request(method, path, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "localhost",
      port: PORT,
      path,
      method,
      headers: { "Content-Type": "application/json", ...headers },
    };
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// SSE は接続を切らないので、最初のデータだけ受け取って切断する
function requestSSE(path, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "localhost", port: PORT, path, method: "GET" }, (res) => {
      let data = "";
      const timer = setTimeout(() => { req.destroy(); resolve({ status: res.statusCode, headers: res.headers, body: data }); }, timeoutMs);
      res.on("data", (c) => (data += c));
      res.on("end", () => { clearTimeout(timer); resolve({ status: res.statusCode, headers: res.headers, body: data }); });
    });
    req.on("error", (err) => { if (err.code === "ECONNRESET") return; reject(err); });
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ── Server lifecycle ──────────────────────────────────────────────────────────

function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn("node", [SERVER], {
      env: { ...process.env, PORT: String(PORT), GOOGLE_CLIENT_ID: "dummy", GOOGLE_CLIENT_SECRET: "dummy", GOOGLE_REFRESH_TOKEN: "dummy" },
    });
    serverProcess.stdout.on("data", (d) => {
      if (d.toString().includes("running on port")) resolve();
    });
    serverProcess.stderr.on("data", (d) => process.stderr.write(d));
    serverProcess.on("error", reject);
    setTimeout(() => reject(new Error("Server did not start in time")), 5000);
  });
}

function stopServer() {
  if (serverProcess) serverProcess.kill();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log("\nHTTP endpoint tests:");

  await test("OPTIONS /sse returns 200 (CORS preflight)", async () => {
    const res = await request("OPTIONS", "/sse");
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await test("CORS headers are present on GET /sse", async () => {
    const res = await requestSSE("/sse");
    assert(res.headers["access-control-allow-origin"] === "*", "Missing Access-Control-Allow-Origin: *");
    assert(res.headers["access-control-allow-methods"], "Missing Access-Control-Allow-Methods");
  });

  await test("GET /sse returns 200 with text/event-stream", async () => {
    const res = await requestSSE("/sse");
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.headers["content-type"]?.includes("text/event-stream"), `Expected text/event-stream, got ${res.headers["content-type"]}`);
  });

  await test("GET /sse sends event: endpoint with session URL", async () => {
    const res = await requestSSE("/sse");
    assert(res.body.includes("event: endpoint"), "Missing 'event: endpoint' in SSE stream");
    assert(res.body.includes("/messages?sessionId="), "Missing sessionId in endpoint URL");
  });

  await test("GET /unknown returns 404", async () => {
    const res = await request("GET", "/unknown");
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  await test("POST /messages returns 202 (fire-and-forget)", async () => {
    const res = await request("POST", "/messages?sessionId=invalid", {
      body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    });
    assert(res.status === 202, `Expected 202, got ${res.status}`);
  });

  await test("POST /messages with malformed JSON does not crash server", async () => {
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: "localhost", port: PORT, path: "/messages?sessionId=x", method: "POST", headers: { "Content-Type": "application/json" } },
        (res) => { res.resume(); resolve({ status: res.statusCode }); }
      );
      req.on("error", reject);
      req.write("not-json");
      req.end();
    });
    assert(res.status === 202, `Expected 202, got ${res.status}`);
  });

  await test("OPTIONS returns Access-Control-Allow-Headers", async () => {
    const res = await request("OPTIONS", "/messages");
    assert(res.headers["access-control-allow-headers"], "Missing Access-Control-Allow-Headers");
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

// ── Entry point ───────────────────────────────────────────────────────────────

startServer()
  .then(run)
  .catch((err) => { console.error("Failed to start server:", err.message); process.exit(1); })
  .finally(stopServer);
