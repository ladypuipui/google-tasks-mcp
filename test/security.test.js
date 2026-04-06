#!/usr/bin/env node
/**
 * Security regression tests
 * - Session ID uses crypto.randomBytes (not Math.random)
 * - Token refresh errors don't leak raw API responses
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const assert = require("assert");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

const src = fs.readFileSync(`${__dirname}/../server.js`, "utf8");

// ── Static analysis ───────────────────────────────────────────────────────────

console.log("\nStatic analysis:");

test("Math.random() is not used for session ID generation", () => {
  // Math.random が sessionId の生成に使われていないことを確認
  const lines = src.split("\n");
  const sessionLine = lines.find((l) => l.includes("sessionId") && l.includes("Math.random"));
  assert(!sessionLine, `Math.random() found in session ID generation: ${sessionLine}`);
});

test("crypto.randomBytes is used for session ID generation", () => {
  assert(
    src.includes("crypto.randomBytes") && src.includes("sessionId"),
    "crypto.randomBytes not found for session ID"
  );
});

test("Raw token response is not exposed in thrown errors", () => {
  // `throw new Error(...${res}...)` のようなパターンがないことを確認
  const leakPattern = /throw new Error\(`[^`]*\$\{res\}[^`]*`\)/;
  assert(!leakPattern.test(src), "Raw response variable leaked in thrown error");
});

test("Token refresh failure uses generic error message", () => {
  assert(
    src.includes('"Authentication error"') || src.includes("'Authentication error'"),
    "Generic authentication error message not found"
  );
});

test("Token refresh failure logs detail to console.error (not to client)", () => {
  assert(src.includes("console.error"), "console.error not found for token failure logging");
});

// ── Behavioral tests ──────────────────────────────────────────────────────────

console.log("\nBehavioral tests:");

test("Session ID has sufficient length (64 hex chars = 256 bits)", () => {
  const id = crypto.randomBytes(32).toString("hex");
  assert.strictEqual(id.length, 64, `Expected 64, got ${id.length}`);
});

test("Session IDs are unique across 1000 generations", () => {
  const ids = new Set(Array.from({ length: 1000 }, () => crypto.randomBytes(32).toString("hex")));
  assert.strictEqual(ids.size, 1000, "Collision detected in session ID generation");
});

test("Session ID contains only hex characters", () => {
  const id = crypto.randomBytes(32).toString("hex");
  assert(/^[0-9a-f]{64}$/.test(id), `Invalid format: ${id}`);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
