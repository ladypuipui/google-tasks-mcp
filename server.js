#!/usr/bin/env node
/**
 * Google Tasks MCP Server (Cloud Run版)
 * HTTP server — Cloud Run が HTTPS を処理する
 */
"use strict";

const https = require("https");
const http = require("http");
const path = require("path");

const PORT = process.env.PORT || 8080;

// ── OAuth2 ──────────────────────────────────────────────────────────────────

let accessToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry - 60_000) return accessToken;

  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    grant_type: "refresh_token",
  }).toString();

  const res = await httpsPost("oauth2.googleapis.com", "/token", body);
  const data = JSON.parse(res);
  if (!data.access_token) throw new Error(`Token refresh failed: ${res}`);
  accessToken = data.access_token;
  tokenExpiry = Date.now() + data.expires_in * 1000;
  return accessToken;
}

function httpsPost(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: "POST",
        hostname,
        path,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => resolve(buf));
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function gapi(method, apiPath, body) {
  const token = await getAccessToken();
  const headers = { Authorization: `Bearer ${token}` };
  let bodyStr;
  if (body) {
    bodyStr = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(bodyStr);
  }
  return new Promise((resolve, reject) => {
    const req = https.request(
      { method, hostname: "tasks.googleapis.com", path: apiPath, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => resolve(buf ? JSON.parse(buf) : null));
      }
    );
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Google Tasks API ─────────────────────────────────────────────────────────

async function listTaskLists() {
  const d = await gapi("GET", "/tasks/v1/users/@me/lists?maxResults=100");
  return d.items || [];
}
async function getDefaultListId() {
  const lists = await listTaskLists();
  if (!lists.length) throw new Error("タスクリストが見つかりません");
  return lists[0].id;
}
async function listTasks(taskListId, showCompleted = false) {
  const id = taskListId || (await getDefaultListId());
  const q = new URLSearchParams({ maxResults: "100", showCompleted: String(showCompleted) });
  const d = await gapi("GET", `/tasks/v1/lists/${encodeURIComponent(id)}/tasks?${q}`);
  return d.items || [];
}
async function createTask(taskListId, title, notes, due) {
  const id = taskListId || (await getDefaultListId());
  const body = { title };
  if (notes) body.notes = notes;
  if (due) body.due = due;
  return gapi("POST", `/tasks/v1/lists/${encodeURIComponent(id)}/tasks`, body);
}
async function updateTask(taskListId, taskId, patch) {
  const id = taskListId || (await getDefaultListId());
  const cur = await gapi("GET", `/tasks/v1/lists/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}`);
  return gapi("PUT", `/tasks/v1/lists/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}`, { ...cur, ...patch });
}
async function completeTask(taskListId, taskId) {
  return updateTask(taskListId, taskId, { status: "completed" });
}
async function deleteTask(taskListId, taskId) {
  const id = taskListId || (await getDefaultListId());
  await gapi("DELETE", `/tasks/v1/lists/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}`);
  return { deleted: true };
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  { name: "list_task_lists", description: "List all Google Task lists", inputSchema: { type: "object", properties: {} } },
  { name: "list_tasks", description: "List tasks in a task list", inputSchema: { type: "object", properties: { taskListId: { type: "string" }, showCompleted: { type: "boolean" } } } },
  { name: "create_task", description: "Create a new task", inputSchema: { type: "object", required: ["title"], properties: { title: { type: "string" }, notes: { type: "string" }, due: { type: "string" }, taskListId: { type: "string" } } } },
  { name: "update_task", description: "Update a task", inputSchema: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" }, taskListId: { type: "string" }, title: { type: "string" }, notes: { type: "string" }, due: { type: "string" } } } },
  { name: "complete_task", description: "Mark a task as completed", inputSchema: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" }, taskListId: { type: "string" } } } },
  { name: "delete_task", description: "Delete a task", inputSchema: { type: "object", required: ["taskId"], properties: { taskId: { type: "string" }, taskListId: { type: "string" } } } },
];

async function callTool(name, args) {
  switch (name) {
    case "list_task_lists": return (await listTaskLists()).map((l) => ({ id: l.id, title: l.title }));
    case "list_tasks": return (await listTasks(args?.taskListId, args?.showCompleted ?? false)).map((t) => ({ id: t.id, title: t.title, status: t.status, due: t.due || null, notes: t.notes || null }));
    case "create_task": return createTask(args?.taskListId, args.title, args?.notes, args?.due);
    case "update_task": {
      const p = {};
      if (args.title !== undefined) p.title = args.title;
      if (args.notes !== undefined) p.notes = args.notes;
      if (args.due !== undefined) p.due = args.due;
      return updateTask(args?.taskListId, args.taskId, p);
    }
    case "complete_task": return completeTask(args?.taskListId, args.taskId);
    case "delete_task": return deleteTask(args?.taskListId, args.taskId);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

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
    const sessionId = Math.random().toString(36).slice(2);
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
