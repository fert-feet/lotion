// 工具展示元数据的漂移守卫。
//
// 事故背景：客户端 AI 面板手抄了一份 7 条图标映射（它不能 import @/lib/ai/*，
// 见 test/boundary.test.ts），服务端 TOOL_META 有 19 条 —— 12 个工具退化成 ⚙️，
// deleteNote/archiveNote 的图标还与服务端不一致。
// 现在两侧同源（lib/tool-meta.ts），这条测试保证"注册了工具但忘了写元数据"会红。
import { describe, it, expect } from "vitest";
import { FALLBACK_TOOL_ICON, TOOL_META, toolIcon, toolLabel } from "@/lib/tool-meta";
import { createDefaultToolRegistry } from "@/lib/ai/tools";

describe("lib/tool-meta 单一真相源", () => {
  it("每个内置工具都有元数据（新增工具必须同步元数据）", () => {
    const names = createDefaultToolRegistry().names();
    expect(names.length).toBeGreaterThan(0);
    const missing = names.filter((name) => !TOOL_META[name]);
    expect(missing, "这些工具没有 label/icon 元数据，前端只会显示 ⚙️").toEqual([]);
  });

  it("元数据条数与内置工具一致（反过来也防幽灵条目）", () => {
    const names = new Set(createDefaultToolRegistry().names());
    const ghosts = Object.keys(TOOL_META).filter((name) => !names.has(name));
    expect(ghosts).toEqual([]);
  });

  it("每条元数据都有非空 label / icon / description", () => {
    for (const [name, meta] of Object.entries(TOOL_META)) {
      expect(meta.label, name).toBeTruthy();
      expect(meta.icon, name).toBeTruthy();
      expect(meta.description, name).toBeTruthy();
    }
  });

  it("插件注册的未知工具回退到通用图标，不崩、不显示 undefined", () => {
    expect(toolIcon("plugin_whatever")).toBe(FALLBACK_TOOL_ICON);
    expect(toolLabel("plugin_whatever")).toBe("plugin_whatever");
  });

  it("客户端此前手抄错的图标以服务端元数据为准", () => {
    expect(toolIcon("deleteNote")).toBe(TOOL_META.deleteNote.icon);
    expect(toolIcon("archiveNote")).toBe(TOOL_META.archiveNote.icon);
    expect(TOOL_META.deleteNote.icon).not.toBe(TOOL_META.archiveNote.icon);
  });
});
