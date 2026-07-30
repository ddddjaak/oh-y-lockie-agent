#!/usr/bin/env node
/**
 * Analyze route telemetry — turns telemetry-routes.jsonl into actionable signal.
 *
 * Run: node scripts/analyze-telemetry.mjs [path-to-jsonl]
 *
 * Outputs:
 *  1. Intent distribution — which intents dominate real usage (optimization focus)
 *  2. Fan-out trigger rate — are multi-perspective signals firing?
 *  3. Skill match rate per intent — where does matchSkill miss most?
 *  4. Miss cases — skillMatched=null grouped by intent+matchedPhrase.
 *     Each group is a SKILL_TRIGGERS gap to fill: users hit that intent phrase
 *     but no skill trigger matched. Add the phrase to the right skill in intent.ts.
 *
 * This is the feedback loop that evals can't provide: evals tests curated
 * queries, telemetry shows what REAL users actually type.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const path = process.argv[2] || join(homedir(), ".opencode", "oh-y-lockie-agent", "telemetry-routes.jsonl");

if (!existsSync(path)) {
  console.error(`telemetry file not found: ${path}`);
  console.error("(run the plugin once to start collecting route events)");
  process.exit(1);
}

const events = readFileSync(path, "utf-8")
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  })
  .filter(Boolean);

if (events.length === 0) {
  console.log("no telemetry events yet.");
  process.exit(0);
}

console.log(`\n=== oh-y-lockie route telemetry: ${events.length} events ===\n`);

// 1. Intent distribution
const intentCounts = {};
for (const e of events) intentCounts[e.intent] = (intentCounts[e.intent] || 0) + 1;
console.log("Intent distribution:");
for (const [intent, count] of Object.entries(intentCounts).sort((a, b) => b[1] - a[1])) {
  const pct = ((count / events.length) * 100).toFixed(1);
  console.log(`  ${intent.padEnd(8)} ${count}  (${pct}%)`);
}

// 2. Fan-out rate
const fanoutCount = events.filter((e) => e.fanout).length;
console.log(`\nFan-out triggered: ${fanoutCount}/${events.length} (${((fanoutCount / events.length) * 100).toFixed(1)}%)`);

// 3. Skill match rate per intent
console.log("\nSkill match rate per intent:");
const byIntent = {};
for (const e of events) {
  if (!byIntent[e.intent]) byIntent[e.intent] = { total: 0, matched: 0 };
  byIntent[e.intent].total++;
  if (e.skillMatched) byIntent[e.intent].matched++;
}
for (const [intent, { total, matched }] of Object.entries(byIntent)) {
  const rate = ((matched / total) * 100).toFixed(0);
  const bar = "█".repeat(Math.round(matched / total * 20)) + "░".repeat(20 - Math.round(matched / total * 20));
  console.log(`  ${intent.padEnd(8)} ${bar} ${matched}/${total} (${rate}%)`);
}

// 4. Miss cases — the actionable part
const misses = events.filter((e) => !e.fanout && !e.skillMatched);
console.log(`\nMiss cases (skillMatched=null): ${misses.length}`);
if (misses.length > 0) {
  const grouped = {};
  for (const m of misses) {
    const phrase = m.matchedPhrase ?? "(none)";
    const key = m.intent + " | phrase=" + JSON.stringify(phrase);
    grouped[key] = (grouped[key] || 0) + 1;
  }
  console.log("  Grouped by intent + matched phrase (fill these SKILL_TRIGGERS gaps):");
  for (const [key, count] of Object.entries(grouped).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${count}x  ${key}`);
  }
}

// 5. Weak matches (low score) — potential trigger-quality issues
const weak = events.filter((e) => !e.fanout && e.skillMatched && e.skillScore <= 3);
if (weak.length > 0) {
  console.log(`\nWeak matches (score≤3, may misroute): ${weak.length}`);
  const grouped = {};
  for (const w of weak) {
    const key = `${w.intent} → ${w.skillMatched} (score=${w.skillScore})`;
    grouped[key] = (grouped[key] || 0) + 1;
  }
  for (const [key, count] of Object.entries(grouped).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`    ${count}x  ${key}`);
  }
}

console.log("");
