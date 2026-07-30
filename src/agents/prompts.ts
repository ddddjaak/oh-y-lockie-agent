import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/agents/prompts.ts -> ../../agents/<name>.md (plugin root / agents)
const AGENTS_DIR = join(__dirname, "..", "..", "agents");

/**
 * Load an agent prompt markdown file from the plugin's `agents/` directory.
 *
 * Prompts live as standalone `.md` files (authored/maintained there) and are
 * loaded by each agent factory at build time — this keeps prompts as the single
 * source of truth while letting agents be defined as code factories.
 */
export function loadPrompt(file: string): string {
  const full = join(AGENTS_DIR, file);
  if (!existsSync(full)) {
    throw new Error(`[oh-y-lockie-agent] agent prompt not found: ${full}`);
  }
  return readFileSync(full, "utf-8");
}
