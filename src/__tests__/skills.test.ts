import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  extractKeywords,
  matchSkill,
  loadSkillContent,
  listSkillNames,
  SKILL_LOAD_TOOL_NAME,
} from "../skills.js";
import type { SkillEntry } from "../skills.js";

// ─── parseFrontmatter ───────────────────────────────────────────

describe("parseFrontmatter", () => {
  it("parses valid frontmatter with LF line endings", () => {
    const content = `---
name: test-skill
description: A test skill description
---
# Content
`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("test-skill");
    expect(result!.description).toBe("A test skill description");
  });

  it("parses valid frontmatter with CRLF line endings (C1 fix)", () => {
    const content = "---\r\nname: test-skill\r\ndescription: A CRLF test\r\n---\r\n# Content\r\n";
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("test-skill");
    expect(result!.description).toBe("A CRLF test");
  });

  it("returns null for content without frontmatter", () => {
    const content = "# Just a heading\n\nNo frontmatter here.";
    const result = parseFrontmatter(content);
    expect(result).toBeNull();
  });

  it("returns null for empty content", () => {
    expect(parseFrontmatter("")).toBeNull();
  });

  it("returns null when name field is missing", () => {
    const content = `---
description: Missing name
---
# Content
`;
    expect(parseFrontmatter(content)).toBeNull();
  });
});

// ─── extractKeywords ────────────────────────────────────────────

describe("extractKeywords", () => {
  it("extracts trigger phrases from 'Use when' pattern", () => {
    const desc = "Use when the user says bootloader, secure boot, OTA. For firmware updates.";
    const keywords = extractKeywords(desc);
    expect(keywords).toContain("bootloader");
    expect(keywords).toContain("secure boot");
    expect(keywords).toContain("ota");
  });

  it("extracts Chinese trigger phrases from '当用户' pattern", () => {
    const desc = "当用户说启动流程、Boot、时钟树。相关技能。";
    const keywords = extractKeywords(desc);
    expect(keywords).toContain("启动流程");
    expect(keywords).toContain("boot");
    expect(keywords).toContain("时钟树");
  });

  it("extracts tech terms from Chinese colon-separated lists (C5 fix: multiple pairs)", () => {
    const desc = "技能覆盖：电源树、电压域。还包括：MPU、TrustZone。更多：调试、性能。";
    const keywords = extractKeywords(desc);
    expect(keywords).toContain("电源树");
    expect(keywords).toContain("电压域");
    expect(keywords).toContain("mpu");
    expect(keywords).toContain("trustzone");
    expect(keywords).toContain("调试");
    expect(keywords).toContain("性能");
  });

  it("returns empty array for empty description", () => {
    expect(extractKeywords("")).toEqual([]);
  });
});

// ─── matchSkill ─────────────────────────────────────────────────

describe("matchSkill", () => {
  const table: SkillEntry[] = [
    {
      name: "bootloader-design",
      description: "Bootloader design skill",
      keywords: ["bootloader", "secure boot", "ota", "dfu"],
    },
    {
      name: "power-management",
      description: "Power management skill",
      keywords: ["power tree", "dvfs", "pmic", "低功耗"],
    },
    {
      name: "general",
      description: "General skill",
      keywords: [],
    },
  ];

  it("matches the best skill by keyword score", () => {
    const match = matchSkill("I need to design a bootloader with secure boot", table);
    expect(match).not.toBeNull();
    expect(match!.name).toBe("bootloader-design");
  });

  it("returns null for input below score threshold", () => {
    // "hello" has no keyword matches, score will be 0
    const match = matchSkill("hello world", table);
    expect(match).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(matchSkill("", table)).toBeNull();
  });

  it("is case-insensitive", () => {
    const match = matchSkill("BOOTLOADER DESIGN", table);
    expect(match).not.toBeNull();
    expect(match!.name).toBe("bootloader-design");
  });

  it("trims whitespace from input", () => {
    const match = matchSkill("  bootloader  ", table);
    expect(match).not.toBeNull();
    expect(match!.name).toBe("bootloader-design");
  });

  it("returns null for empty skill table", () => {
    expect(matchSkill("bootloader", [])).toBeNull();
  });
});

// ─── loadSkillContent / listSkillNames ──────────────────────────

describe("loadSkillContent", () => {
  it("loads a real skill from the plugin's opencode skills directory by exact name", () => {
    const loaded = loadSkillContent("bootloader-design");
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe("bootloader-design");
    expect(loaded!.source).toBe("opencode");
    expect(loaded!.content).toContain("---");
    expect(loaded!.content.toLowerCase()).toContain("bootloader");
  });

  it("matches by fuzzy name", () => {
    const loaded = loadSkillContent("bootloader");
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe("bootloader-design");
  });

  it("matches normalized names (hyphens/spaces removed)", () => {
    const loaded = loadSkillContent("registermap");
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe("register-map");
  });

  it("returns null for unknown skills", () => {
    expect(loadSkillContent("no-such-skill-xyz")).toBeNull();
  });

  it("returns null for empty query", () => {
    expect(loadSkillContent("   ")).toBeNull();
  });
});

describe("listSkillNames", () => {
  it("lists all bundled skills (56 opencode + 7 agents)", () => {
    const names = listSkillNames();
    expect(names.length).toBe(63);
    expect(names).toContain("bootloader-design");
    expect(names).toContain("company-docx-generator");
  });
});

describe("SKILL_LOAD_TOOL_NAME", () => {
  it("is the tool name the routing instructions reference", () => {
    expect(SKILL_LOAD_TOOL_NAME).toBe("lockie_load_skill");
  });
});
