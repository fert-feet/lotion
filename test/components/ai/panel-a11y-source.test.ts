import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../../..");

function source(file: string) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

describe("AI 面板现代交互语义", () => {
  it("输入卡使用原生 form、label 与 submit 路径", () => {
    const panel = source("src/shell/ai-panel.tsx");
    expect(panel).toContain('aria-label="向文档助手发送消息"');
    expect(panel).toContain("<form");
    expect(panel).toContain("event.preventDefault()");
    expect(panel).toContain("htmlFor={composerId}");
    expect(panel).toContain('type={loading ? "button" : "submit"}');
  });

  it("流式正文不再作为 live region 逐 token 播报，改由独立状态区汇报关键节点", () => {
    const panel = source("src/shell/ai-panel.tsx");
    expect(panel).toMatch(/role="log"[\s\S]{0,160}aria-live="off"/);
    expect(panel).toMatch(/role="status"[\s\S]{0,80}aria-live="polite"/);
    expect(panel).not.toMatch(/role="log"[\s\S]{0,120}aria-relevant="additions text"/);
  });

  it("@ 文档选择器暴露 active descendant 与 option 状态", () => {
    const input = source("src/shell/mention-input.tsx");
    expect(input).toContain('role="listbox"');
    expect(input).toContain('role="option"');
    expect(input).toContain("aria-activedescendant");
    expect(input).toContain("aria-selected={i === highlightIndex}");
  });

  it("会话历史使用 search 与切换状态，不再用 div role=button", () => {
    const menu = source("src/shell/ai/session-menu.tsx");
    expect(menu).toContain("<search");
    expect(menu).toContain('type="search"');
    expect(menu).toContain("aria-pressed={scope === value}");
    expect(menu).not.toContain('role="button"');
  });

  it("结构化提问使用原生单选/复选控件，并保留可触达的操作尺寸", () => {
    const turn = source("src/shell/ai/turn.tsx");
    expect(turn).toContain('type={question.multiple ? "checkbox" : "radio"}');
    expect(turn).toContain("min-h-10");
    expect(turn).toContain("min-h-7");
  });
});
