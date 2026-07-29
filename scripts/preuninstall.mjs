#!/usr/bin/env node
// oh-y-lockie-agent preuninstall — clean up static files on uninstall
import { rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..");
const OPENCODE_DIR = join(homedir(), ".config", "opencode");
const AGENTS_DIR = join(homedir(), ".agents");

console.log("[oh-y-lockie-agent] preuninstall: 开始清理静态文件...");

/**
 * Read a directory's file listing and remove only files/subdirs
 * that match a given prefix list.
 */
function removeMatchingEntries(dir, names) {
  if (!existsSync(dir)) return;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (names.includes(entry.name)) {
        const full = join(dir, entry.name);
        rmSync(full, { recursive: true, force: true });
        console.log(`  [删除] ${full}`);
      }
    }
  } catch (e) {
    // Individual failures are non-fatal — don't block npm uninstall
    console.error(`  [警告] 无法清理 ${dir}: ${e.message}`);
  }
}

// -----------------------------------------------------------------
// Agent .md files from this plugin
// -----------------------------------------------------------------
const LOCKIE_AGENT_FILES = [
  "architect.md",
  "firmware.md",
  "power-architect.md",
  "boot-bringup-specialist.md",
  "memory-map-specialist.md",
  "firmware-architect.md",
  "timing-analyst.md",
  "register-map-generator.md",
  "code-reviewer.md",
  "security-auditor.md",
  "system-architect.md",
  "fw-domain-expert.md",
  "hw-domain-expert.md",
  "compliance-reviewer.md",
  "test-engineer.md",
  "verification-engineer.md",
];

// -----------------------------------------------------------------
// Skill directory names from this plugin (skills/opencode/)
// -----------------------------------------------------------------
const LOCKIE_SKILL_DIRS = [
  "algorithm-design", "api-and-interface-design", "architecture-design",
  "board-bringup", "bootloader-design", "ci-cd-and-automation",
  "clock-configuration", "clonedeps", "code-review-and-quality",
  "code-simplification", "code-static-review", "context-engineering",
  "debugging-and-error-recovery", "deepwork", "deprecation-and-migration",
  "design-review", "device-tree", "documentation-and-adrs",
  "doubt-driven-development", "embedded-build-and-toolchain",
  "embedded-debugging", "git-workflow-and-versioning", "idea-refine",
  "incremental-implementation", "interview-me", "memory-protection",
  "performance-optimization", "peripheral-driver-design",
  "planning-and-task-breakdown", "power-management",
  "release-review", "requirements-decompose", "requirements-review",
  "rtos-and-concurrency", "security-and-hardening", "shipping-and-launch",
  "simplify", "software-architecture-design", "source-driven-development",
  "spec-authoring", "spec-driven-development",
  "test-driven-development", "test-plan-review", "test-report-review",
  "traceability-matrix", "verification-planning", "worktrees",
];

// -----------------------------------------------------------------
// Skill directory names from this plugin (skills/agents/)
// -----------------------------------------------------------------
const LOCKIE_AGENT_SKILL_DIRS = [
  "company-docx-generator", "company-pptx-generator",
  "markdown-to-docx", "markitdown", "mermaid-diagram-generation",
  "storage-analysis", "zephyr-doxygen-docs",
];

// -----------------------------------------------------------------
// Command file names from this plugin
// -----------------------------------------------------------------
const LOCKIE_COMMAND_FILES = [
  "boot-sequence.md", "bringup.md", "build.md", "clock-tree.md",
  "code-simplify.md", "fault-analysis.md", "memory-map.md",
  "pinmux.md", "plan.md", "power-tree.md", "register-map.md",
  "review.md", "se-architecture.md", "se-goal.md",
  "se-requirements.md", "se-review.md", "se-spec.md",
  "se-traceability.md", "ship.md", "spec.md", "test.md",
];

// -----------------------------------------------------------------
// Reference files
// -----------------------------------------------------------------
const LOCKIE_REFERENCE_FILES = [
  "testing-patterns.md", "security-checklist.md",
];

console.log("\n  --- 清理 agents ---");
removeMatchingEntries(join(OPENCODE_DIR, "agents"), LOCKIE_AGENT_FILES);

console.log("\n  --- 清理 commands ---");
removeMatchingEntries(join(OPENCODE_DIR, "commands"), LOCKIE_COMMAND_FILES);

console.log("\n  --- 清理 skills/opencode ---");
removeMatchingEntries(join(OPENCODE_DIR, "skills"), LOCKIE_SKILL_DIRS);

console.log("\n  --- 清理 skills/agents ---");
removeMatchingEntries(join(AGENTS_DIR, "skills"), LOCKIE_AGENT_SKILL_DIRS);

console.log("\n  --- 清理 references ---");
removeMatchingEntries(join(OPENCODE_DIR, "references"), LOCKIE_REFERENCE_FILES);

// -----------------------------------------------------------------
// Config file — only remove if it matches the plugin default exactly
// (user-customized config is preserved)
// -----------------------------------------------------------------
const configPath = join(OPENCODE_DIR, "oh-y-lockie-agent.jsonc");
if (existsSync(configPath)) {
  console.log(`\n  [保留] ${configPath}（用户配置文件 — 如需删除请手动操作）`);
}

// Root AGENTS.md
const agentsMdPath = join(homedir(), "AGENTS.md");
if (existsSync(agentsMdPath)) {
  // Check if it's ours by looking for lockie identifier
  try {
    const content = readFileSync(agentsMdPath, "utf-8").substring(0, 200);
    if (content.includes("oh-y-lockie-agent") || content.includes("lockie")) {
      rmSync(agentsMdPath, { force: true });
      console.log(`\n  [删除] ${agentsMdPath}`);
    }
  } catch {
    // Skip if we can't read it
  }
}

console.log("\n[oh-y-lockie-agent] preuninstall: 完成");
