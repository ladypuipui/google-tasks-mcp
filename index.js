#!/usr/bin/env node
/**
 * Google Tasks MCP Server — stdio エントリ
 * Claude Code / Claude Desktop からローカルで使う用途。
 * 認証・API・ツール定義は core.js に集約。
 */
"use strict";

const { TOOLS, callTool } = require("./core");

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
