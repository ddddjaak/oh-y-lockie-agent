/**
 * Model availability probing + resolution for oh-y-lockie-agent.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The plugin's agent definitions hardcode default models like
 * `ddddjaak/mimo-v2.5`. That provider ID only exists on the plugin author's
 * machine — a fresh user with a different provider (e.g. `my-mimo`) would get
 * "Model not found" for EVERY subagent. We can't hardcode a provider that
 * exists everywhere, so we PROBE the user's configured providers at config-hook
 * time and resolve each agent to a model that actually exists:
 *
 *   override.model  (explicit user intent)          > available → use it
 *   override.model  same base name, other provider  → use first match
 *   def.defaultModel                                 > available → use it
 *   defaultModel's base name on another provider     → use first match
 *   any available model (last resort, loud log)      → use it
 *
 * A probe with NO available models (empty cfg.provider) means "can't inspect
 * the environment" — in that case we fall back to the definition's default and
 * register every agent, preserving the pre-probe behavior (and test fixtures
 * that boot the plugin with an empty Config).
 *
 * All functions are pure and synchronous — no I/O.
 */

/** A snapshot of the models the runtime can actually call. */
export interface ModelProbe {
  /** Full model IDs like "my-mimo/mimo-v2.5". */
  available: Set<string>;
  /** Base model name -> full IDs (same name on several providers). */
  byName: Map<string, string[]>;
  /** All full IDs in provider config order. */
  any: string[];
}

/** Minimal shape of one provider config entry we need to probe models. */
export interface ProviderLike {
  models?: Record<string, unknown>;
}

/**
 * Substrings that identify clearly non-chat models. The probe indexes every
 * model a provider declares; blindly including embedding/audio/image models in
 * the fallback pool could hand an agent a model that cannot hold a dialogue.
 */
const NON_CHAT_TOKENS = [
  "embedding", "embeddings", "whisper", "tts", "speech", "stt", "transcri",
  "dall-e", "dalle", "sdxl", "stable-diffusion", "flux", "moderation",
  "rerank", "reranker", "image", "audio", "ttv", "video",
];

/**
 * Whether a model ID looks chat-capable. Conservative: only excludes models
 * whose base name clearly matches a non-dialogue category. Vision-capable chat
 * models (e.g. gpt-4o, qwen-vl) are NOT excluded.
 */
export function isLikelyChatModel(modelKey: string): boolean {
  const base = modelKey.split("/").pop() ?? modelKey;
  const lower = base.toLowerCase();
  return !NON_CHAT_TOKENS.some((t) => lower.includes(t));
}

/**
 * Probe a Config.provider map and index every declared model.
 *
 * Non-chat models (embeddings, whisper, image generation, rerankers, ...) are
 * excluded from the index so fallback resolution never lands on a model that
 * cannot converse.
 *
 * @param provider Config's provider section (may be undefined).
 * @returns A ModelProbe. `any` is empty when nothing is declared — callers
 *          treat that as "environment unknown", not "no models exist".
 */
export function probeModels(
  provider?: Record<string, ProviderLike>,
): ModelProbe {
  const available = new Set<string>();
  const byName = new Map<string, string[]>();
  const any: string[] = [];

  if (!provider) return { available, byName, any };

  // Defensive: a malformed provider section (null / non-object) must never
  // throw out of the config hook — treat it as "nothing to probe".
  if (typeof provider !== "object") return { available, byName, any };

  for (const [providerID, pconf] of Object.entries(provider)) {
    for (const modelKey of Object.keys(pconf?.models ?? {})) {
      if (!isLikelyChatModel(modelKey)) continue;
      const full = `${providerID}/${modelKey}`;
      available.add(full);
      any.push(full);
      const matches = byName.get(modelKey) ?? [];
      matches.push(full);
      byName.set(modelKey, matches);
    }
  }

  return { available, byName, any };
}

/**
 * Probe a provider section whose runtime type is unknown (e.g. read from a
 * foreign `Config` object or a raw JSON file). Isolates the unavoidable
 * structural cast here so callers never touch `as`.
 */
export function probeFromRawProvider(provider: unknown): ModelProbe {
  if (!provider || typeof provider !== "object") {
    return probeModels(undefined);
  }
  return probeModels(provider as Record<string, ProviderLike>);
}

/** Result of resolving one agent to a concrete model. */
export type ResolvedModel = {
  action: "use";
  model: string;
  reason: string;
};

/**
 * Resolve which model an agent should use, given user overrides and the
 * environment probe. Pure function — never throws, NEVER skips: every agent
 * gets SOME model (an unresolvable override falls back down the chain), so the
 * plugin never silently loses an agent.
 *
 * Resolution chain (first available wins):
 *   1. override.model, exact
 *   2. override.model's base name on another provider
 *   3. defaultModel, exact
 *   4. defaultModel's base name on another provider
 *   5. any available model (last resort, loud log)
 *
 * @param ov     User override for this agent (model / disable).
 * @param probe  Environment model probe. `undefined` or empty → fall back to
 *               default (register, never skip).
 * @param defaultModel  The agent definition's default model.
 */
export function resolveAgentModel(
  ov: { model?: string } | undefined,
  probe: ModelProbe | undefined,
  defaultModel: string,
): ResolvedModel {
  const explicit = ov?.model;

  // No probe, or nothing declared in the environment: keep legacy behavior —
  // use the override or default and register. We cannot gate what we can't see.
  if (!probe || probe.any.length === 0) {
    return { action: "use", model: explicit ?? defaultModel, reason: "no-probe" };
  }

  // Candidate chain, first available wins. `explicit` is tried first (exact,
  // then same base name); if both miss we fall back to the definition default,
  // then any model — an agent is never dropped.
  const candidates: Array<{ model: string; reason: string }> = [];
  if (explicit) {
    if (probe.available.has(explicit)) {
      candidates.push({ model: explicit, reason: "override" });
    } else {
      const sameName = probe.byName.get(explicit);
      if (sameName?.length) {
        candidates.push({ model: sameName[0], reason: "override-name" });
      }
      candidates.push({ model: defaultModel, reason: "override-unavailable-default" });
    }
  } else {
    candidates.push({ model: defaultModel, reason: "default" });
  }

  // 1-4: exact match, then same-base-name across providers, per candidate.
  for (const c of candidates) {
    if (probe.available.has(c.model)) {
      return { action: "use", model: c.model, reason: c.reason };
    }
    const base = c.model.split("/").pop() ?? c.model;
    const sameName = probe.byName.get(base);
    if (sameName?.length) {
      return { action: "use", model: sameName[0], reason: `${c.reason}-name` };
    }
  }

  // 5: any available model — better a working agent than a missing one.
  return { action: "use", model: probe.any[0], reason: "fallback-any" };
}
