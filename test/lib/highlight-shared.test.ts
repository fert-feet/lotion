// 高亮共用表的一致性守卫：编辑器侧（BlockNote 下拉/扩展）与 AI 正文侧（markdown 代码块）
// 必须落在同一张白名单上——两处曾经各写一份 loader 表，加一种语言要改两个地方。
import { describe, it, expect } from "vitest";
import { HIGHLIGHT_LANGS } from "@/lib/highlight-langs";
import {
  HIGHLIGHT_THEMES,
  createLotionHighlighter,
  highlightLangLoaders,
  highlightThemeLoaders,
} from "@/lib/highlight-shared";
import { lotionCodeBlockOptions } from "@/lib/code-highlight";

describe("shiki 高亮共用表", () => {
  it("白名单里的每种语言都有 loader（加语言只改 highlight-langs + loader 表）", () => {
    for (const lang of HIGHLIGHT_LANGS) {
      expect(highlightLangLoaders, `缺少 ${lang} 的 loader`).toHaveProperty(lang);
      expect(typeof highlightLangLoaders[lang]).toBe("function");
    }
  });

  it("别名 loader 与规范名指向同一个模块（shiki 按 key 去重，不会重复下载）", () => {
    const aliases: Record<string, string> = {
      js: "javascript",
      ts: "typescript",
      sh: "bash",
      shell: "bash",
      py: "python",
      yml: "yaml",
      md: "markdown",
      rs: "rust",
    };
    const loaders = highlightLangLoaders as Record<string, unknown>;
    for (const [alias, canonical] of Object.entries(aliases)) {
      expect(loaders[alias], `别名 ${alias} 缺 loader`).toBeTypeOf("function");
      expect(loaders[alias], `别名 ${alias} 应当复用 ${canonical} 的 loader`).toBe(
        loaders[canonical],
      );
    }
  });

  it("主题表与 HIGHLIGHT_THEMES 对齐（明暗各一套，缺一个就没有双主题）", () => {
    expect(Object.keys(highlightThemeLoaders).sort()).toEqual([...HIGHLIGHT_THEMES].sort());
  });

  it("编辑器下拉表没有引白名单之外的语言（否则选了却没有语法高亮）", () => {
    const allowed = new Set<string>(["text", ...HIGHLIGHT_LANGS]);
    for (const lang of Object.keys(lotionCodeBlockOptions.supportedLanguages ?? {})) {
      expect(allowed.has(lang), `下拉里的 ${lang} 不在高亮白名单里`).toBe(true);
    }
  });

  it("工厂可以真的建出高亮器并加载一个语言", async () => {
    const highlighter = await createLotionHighlighter({ themes: [...HIGHLIGHT_THEMES], langs: [] });
    await highlighter.loadLanguage("json");
    expect(highlighter.getLoadedLanguages()).toContain("json");
    expect(highlighter.getLoadedThemes().sort()).toEqual([...HIGHLIGHT_THEMES].sort());
  });
});
