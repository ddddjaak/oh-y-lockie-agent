import { describe, it, expect } from "vitest";
import { probeModels, resolveAgentModel } from "../models.js";
import { collectAgents } from "../agents/index.js";

describe("probeModels", () => {
  it("indexes provider/model pairs into full IDs", () => {
    const probe = probeModels({
      "my-mimo": { models: { "mimo-v2.5": {}, "mimo-v2.5-pro": {} } },
      other: { models: { "gpt-x": {} } },
    });
    expect(probe.available.has("my-mimo/mimo-v2.5")).toBe(true);
    expect(probe.available.has("my-mimo/mimo-v2.5-pro")).toBe(true);
    expect(probe.available.has("other/gpt-x")).toBe(true);
    expect(probe.any).toEqual(["my-mimo/mimo-v2.5", "my-mimo/mimo-v2.5-pro", "other/gpt-x"]);
    expect(probe.byName.get("mimo-v2.5")).toEqual(["my-mimo/mimo-v2.5"]);
  });

  it("returns an empty probe when provider is undefined", () => {
    const probe = probeModels(undefined);
    expect(probe.any.length).toBe(0);
    expect(probe.available.size).toBe(0);
  });

  it("ignores providers without a models section", () => {
    const probe = probeModels({ bare: {}, "my-mimo": { models: { x: {} } } });
    expect(probe.any).toEqual(["my-mimo/x"]);
  });

  it("excludes clearly non-chat models (embeddings/whisper/image) from the probe", () => {
    const probe = probeModels({
      p: {
        models: {
          "gpt-x": {},
          "text-embedding-3": {},
          "whisper-1": {},
          "dall-e-3": {},
          "rerank-2": {},
        },
      },
    });
    expect(probe.available.has("p/gpt-x")).toBe(true);
    expect(probe.available.has("p/text-embedding-3")).toBe(false);
    expect(probe.available.has("p/whisper-1")).toBe(false);
    expect(probe.available.has("p/dall-e-3")).toBe(false);
    expect(probe.available.has("p/rerank-2")).toBe(false);
    expect(probe.any).toEqual(["p/gpt-x"]);
  });

  it("keeps vision-capable chat models (gpt-4o, qwen-vl) in the probe", () => {
    const probe = probeModels({
      p: { models: { "gpt-4o": {}, "qwen-vl-max": {} } },
    });
    expect(probe.available.has("p/gpt-4o")).toBe(true);
    expect(probe.available.has("p/qwen-vl-max")).toBe(true);
  });
});

describe("resolveAgentModel", () => {
  const probe = probeModels({
    "my-mimo": { models: { "mimo-v2.5": {}, "mimo-v2.5-pro": {} } },
  });
  const DEF_MODEL = "ddddjaak/mimo-v2.5";

  it("falls back to default when there is no probe or empty probe", () => {
    expect(resolveAgentModel(undefined, undefined, DEF_MODEL)).toEqual({
      action: "use",
      model: DEF_MODEL,
      reason: "no-probe",
    });
    expect(resolveAgentModel(undefined, probeModels(undefined), DEF_MODEL).action).toBe("use");
  });

  it("uses an available explicit override", () => {
    const r = resolveAgentModel({ model: "my-mimo/mimo-v2.5-pro" }, probe, DEF_MODEL);
    expect(r).toMatchObject({ action: "use", model: "my-mimo/mimo-v2.5-pro", reason: "override" });
  });

  it("resolves a bare override name to the matching provider model", () => {
    const r = resolveAgentModel({ model: "mimo-v2.5-pro" }, probe, DEF_MODEL);
    expect(r).toMatchObject({ action: "use", model: "my-mimo/mimo-v2.5-pro", reason: "override-name" });
  });

  it("falls back to default when an explicit override is unresolvable", () => {
    // override "nope/model" unavailable → default "ddddjaak/mimo-v2.5" also
    // unavailable → same base name on my-mimo wins
    const r = resolveAgentModel({ model: "nope/model" }, probe, DEF_MODEL);
    expect(r).toMatchObject({ action: "use", model: "my-mimo/mimo-v2.5" });
    expect(r.reason).toContain("override-unavailable-default");
  });

  it("uses the default when it is available", () => {
    const p = probeModels({ ddddjaak: { models: { "mimo-v2.5": {} } } });
    const r = resolveAgentModel(undefined, p, "ddddjaak/mimo-v2.5");
    expect(r).toMatchObject({ action: "use", model: "ddddjaak/mimo-v2.5", reason: "default" });
  });

  it("falls back to same-named model on another provider", () => {
    // default "ddddjaak/mimo-v2.5" unavailable → same base name on my-mimo
    const r = resolveAgentModel(undefined, probe, DEF_MODEL);
    expect(r).toMatchObject({ action: "use", model: "my-mimo/mimo-v2.5", reason: "default-name" });
  });

  it("falls back to any available model as last resort", () => {
    const p = probeModels({ only: { models: { "gpt-x": {} } } });
    const r = resolveAgentModel(undefined, p, "ddddjaak/mimo-v2.5");
    expect(r).toMatchObject({ action: "use", model: "only/gpt-x", reason: "fallback-any" });
  });
});

describe("collectAgents with ModelProbe", () => {
  it("resolves every agent to an available model when defaults mismatch", () => {
    const probe = probeModels({ "my-mimo": { models: { "mimo-v2.5": {}, "mimo-v2.5-pro": {} } } });
    const agents = collectAgents({}, probe);
    // 16 agents, none skipped, all resolved to my-mimo models
    expect(Object.keys(agents).length).toBe(16);
    expect(agents.architect.model).toBe("my-mimo/mimo-v2.5");
    expect(agents["code-reviewer"].model).toBe("my-mimo/mimo-v2.5-pro");
  });

  it("falls back instead of dropping agents when an override is unavailable", () => {
    const probe = probeModels({ "my-mimo": { models: { "mimo-v2.5": {} } } });
    const agents = collectAgents(
      { architect: { model: "bogus/provider" } },
      probe,
    );
    // never silently drops an agent — falls back to a resolvable model
    expect(agents.architect).toBeDefined();
    expect(agents.architect.model).toBe("my-mimo/mimo-v2.5");
    expect(agents.firmware).toBeDefined();
  });

  it("keeps legacy Set gate semantics unchanged", () => {
    const agents = collectAgents({}, new Set(["other-model"]));
    expect(Object.keys(agents).length).toBe(0);
  });
});
