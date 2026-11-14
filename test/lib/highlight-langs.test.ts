// 围栏语言归一的单测：AI 正文的代码块高亮只认这一张表。
import { describe, it, expect } from "vitest";
import { HIGHLIGHT_LANGS, normalizeFenceLang } from "@/lib/highlight-langs";

describe("围栏语言归一（normalizeFenceLang）", () => {
  it("规范语言名原样通过（大小写不敏感）", () => {
    expect(normalizeFenceLang("typescript")).toBe("typescript");
    expect(normalizeFenceLang("TypeScript")).toBe("typescript");
    expect(normalizeFenceLang("CPP")).toBe("cpp");
    expect(normalizeFenceLang("diff")).toBe("diff");
  });

  it("常见别名归一（js / ts / sh / py / yml / md / rs / c++）", () => {
    expect(normalizeFenceLang("js")).toBe("javascript");
    expect(normalizeFenceLang("ts")).toBe("typescript");
    expect(normalizeFenceLang("sh")).toBe("bash");
    expect(normalizeFenceLang("shell")).toBe("bash");
    expect(normalizeFenceLang("py")).toBe("python");
    expect(normalizeFenceLang("yml")).toBe("yaml");
    expect(normalizeFenceLang("md")).toBe("markdown");
    expect(normalizeFenceLang("rs")).toBe("rust");
    expect(normalizeFenceLang("c++")).toBe("cpp");
  });

  it("info string 带附加信息时只看第一个 token（```ts title=x）", () => {
    expect(normalizeFenceLang('ts title="a.ts"')).toBe("typescript");
    expect(normalizeFenceLang("  python   ")).toBe("python");
  });

  it("明确纯文本 / 未知语言 / 缺省一律返回 null（退化为纯文本）", () => {
    for (const plain of ["text", "txt", "plain", "plaintext", "output", "log", ""]) {
      expect(normalizeFenceLang(plain), `${plain} 应当视为纯文本`).toBeNull();
    }
    expect(normalizeFenceLang("dockerfile")).toBeNull();
    expect(normalizeFenceLang("brainfuck")).toBeNull();
    expect(normalizeFenceLang(undefined)).toBeNull();
  });

  it("白名单里的每一项都能归一（防止 HIGHLIGHT_LANGS 与别名表脱节）", () => {
    for (const lang of HIGHLIGHT_LANGS) {
      expect(normalizeFenceLang(lang), `${lang} 应当能归一`).toBe(lang);
    }
  });
});
