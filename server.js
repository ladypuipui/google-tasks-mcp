#!/usr/bin/env node
/**
 * Google Tasks MCP Server — HTTP/SSE エントリ (Cloud Run / Docker 常駐用)
 * HTTP server — Cloud Run / リバースプロキシが HTTPS を処理する想定。
 * 認証・API・ツール定義は core.js に集約。
 */
"use strict";

const http = require("http");
const crypto = require("crypto");

const { TOOLS, callTool } = require("./core");

const PORT = process.env.PORT || 8080;

// ── MCP over HTTP/SSE ─────────────────────────────────────────────────────────

const sseClients = new Map(); // sessionId -> res

function sendToClient(sessionId, obj) {
  const res = sseClients.get(sessionId);
  if (res) res.write(`event: message\ndata: ${JSON.stringify(obj)}\n\n`);
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // SSE endpoint
  if (req.method === "GET" && url.pathname === "/sse") {
    const sessionId = crypto.randomBytes(32).toString("hex");
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    sseClients.set(sessionId, res);

    // Send endpoint info — Cloud Run URL from X-Forwarded-Host or HOST header
    const host = req.headers["x-forwarded-host"] || req.headers["host"] || `localhost:${PORT}`;
    const scheme = req.headers["x-forwarded-proto"] || "https";
    res.write(`event: endpoint\ndata: ${scheme}://${host}/messages?sessionId=${sessionId}\n\n`);

    // Keep-alive ping every 15s
    const keepAlive = setInterval(() => {
      if (sseClients.has(sessionId)) res.write(`: ping\n\n`);
      else clearInterval(keepAlive);
    }, 15000);

    req.on("close", () => { sseClients.delete(sessionId); clearInterval(keepAlive); });
    return;
  }

  // Messages endpoint
  if (req.method === "POST" && url.pathname === "/messages") {
    const sessionId = url.searchParams.get("sessionId");
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      res.writeHead(202); res.end();
      let msg;
      try { msg = JSON.parse(body); } catch { return; }
      const { id, method, params } = msg;
      try {
        switch (method) {
          case "initialize":
            sendToClient(sessionId, { jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "google-tasks", version: "0.1.0" } } });
            break;
          case "tools/list":
            sendToClient(sessionId, { jsonrpc: "2.0", id, result: { tools: TOOLS } });
            break;
          case "tools/call": {
            const result = await callTool(params.name, params.arguments);
            sendToClient(sessionId, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } });
            break;
          }
          default:
            if (id !== undefined) sendToClient(sessionId, { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
        }
      } catch (err) {
        if (id !== undefined) sendToClient(sessionId, { jsonrpc: "2.0", id, error: { code: -32603, message: err.message } });
      }
    });
    return;
  }

  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`✅ Google Tasks MCP server running on port ${PORT}`);
});
