#!/usr/bin/env node
/**
 * Google Tasks MCP Server
 * Zero dependencies — uses only Node.js built-ins
 */
import https from "https";

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

  const res = await httpsRequest("POST", "oauth2.googleapis.com", "/token", body, {
    "Content-Type": "application/x-www-form-urlencoded",
    "Content-Length": Buffer.byteLength(body),
  });

  const data = JSON.parse(res);
  if (!data.access_token) throw new Error(`Token refresh failed: ${res}`);
  accessToken = data.access_token;
  tokenExpiry = Date.now() + data.expires_in * 1000;
  return accessToken;
}

// ── HTTPS helper ─────────────────────────────────────────────────────────────

function httpsRequest(method, hostname, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { method, hostname, path, headers: { ...extraHeaders } },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => resolve(buf));
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function gapi(method, path, body) {
  const token = await getAccessToken();
  const headers = { Authorization: `Bearer ${token}` };
  let bodyStr;
  if (body) {
    bodyStr = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(bodyStr);
  }
  const res = await httpsRequest(method, "tasks.googleapis.com", path, bodyStr, headers);
  return res ? JSON.parse(res) : null;
}

// ── Google Tasks API ─────────────────────────────────────────────────────────

async function listTaskLists() {
  const data = await gapi("GET", "/tasks/v1/users/@me/lists?maxResults=100");
  return data.items || [];
}

async function getDefaultListId() {
  const lists = await listTaskLists();
  if (!lists.length) throw new Error("タスクリストが見つかりません");
  return lists[0].id;
}

async function listTasks(taskListId, showCompleted = false) {
  const id = taskListId || (await getDefaultListId());
  const q = new URLSearchParams({ maxResults: "100", showCompleted: String(showCompleted), showHidden: String(showCompleted) });
  const data = await gapi("GET", `/tasks/v1/lists/${encodeURIComponent(id)}/tasks?${q}`);
  return data.items || [];
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
  const current = await gapi("GET", `/tasks/v1/lists/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}`);
  const updated = { ...current, ...patch };
  return gapi("PUT", `/tasks/v1/lists/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}`, updated);
}

async function completeTask(taskListId, taskId) {
  return updateTask(taskListId, taskId, { status: "completed" });
}

async function deleteTask(taskListId, taskId) {
  const id = taskListId || (await getDefaultListId());
  await gapi("DELETE", `/tasks/v1/lists/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}`);
  return { deleted: true };
}

// ── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "list_task_lists",
    description: "List all Google Task lists",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_tasks",
    description: "List tasks in a task list",
    inputSchema: {
      type: "object",
      properties: {
        taskListId: { type: "string", description: "Task list ID (omit for default list)" },
        showCompleted: { type: "boolean", description: "Include completed tasks (default: false)" },
      },
    },
  },
  {
    name: "create_task",
    description: "Create a new task",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string" },
        notes: { type: "string" },
        due: { type: "string", description: "RFC 3339 (e.g. 2026-04-10T00:00:00Z)" },
        taskListId: { type: "string", description: "Task list ID (omit for default list)" },
      },
    },
  },
  {
    name: "update_task",
    description: "Update a task's title, notes, or due date",
    inputSchema: {
      type: "object",
      required: ["taskId"],
      properties: {
        taskId: { type: "string" },
        taskListId: { type: "string" },
        title: { type: "string" },
        notes: { type: "string" },
        due: { type: "string" },
      },
    },
  },
  {
    name: "complete_task",
    description: "Mark a task as completed",
    inputSchema: {
      type: "object",
      required: ["taskId"],
      properties: {
        taskId: { type: "string" },
        taskListId: { type: "string" },
      },
    },
  },
  {
    name: "delete_task",
    description: "Delete a task permanently",
    inputSchema: {
      type: "object",
      required: ["taskId"],
      properties: {
        taskId: { type: "string" },
        taskListId: { type: "string" },
      },
    },
  },
];

// ── Tool handler ──────────────────────────────────────────────────────────────

async function callTool(name, args) {
  switch (name) {
    case "list_task_lists": {
      const lists = await listTaskLists();
      return lists.map((l) => ({ id: l.id, title: l.title }));
    }
    case "list_tasks": {
      const items = await listTasks(args?.taskListId, args?.showCompleted ?? false);
      return items.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        due: t.due || null,
        completed: t.completed || null,
        notes: t.notes || null,
      }));
    }
    case "create_task":
      return createTask(args?.taskListId, args.title, args?.notes, args?.due);
    case "update_task": {
      const patch = {};
      if (args.title !== undefined) patch.title = args.title;
      if (args.notes !== undefined) patch.notes = args.notes;
      if (args.due !== undefined) patch.due = args.due;
      return updateTask(args?.taskListId, args.taskId, patch);
    }
    case "complete_task":
      return completeTask(args?.taskListId, args.taskId);
    case "delete_task":
      return deleteTask(args?.taskListId, args.taskId);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── MCP stdio server (newline-delimited JSON-RPC 2.0) ─────────────────────────

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  const lines = buf.split("\n");
  buf = lines.pop();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      continue;
    }
    handleMessage(msg);
  }
});

async function handleMessage(msg) {
  const { id, method, params } = msg;

  try {
    switch (method) {
      case "initialize":
        respond(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "google-tasks", version: "0.1.0" },
        });
        break;

      case "notifications/initialized":
      case "initialized":
        break;

      case "tools/list":
        respond(id, { tools: TOOLS });
        break;

      case "tools/call": {
        const { name, arguments: args } = params;
        const result = await callTool(name, args);
        respond(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        });
        break;
      }

      default:
        if (id !== undefined) {
          respondError(id, -32601, `Method not found: ${method}`);
        }
    }
  } catch (err) {
    if (id !== undefined) {
      respondError(id, -32603, err.message);
    }
  }
}
