// 内置插件目录与组合清单的一致性守卫。
// 事故预防：新增组合条目却忘了写元数据，设置界面就会"少一个插件"且没有报错。
import { describe, expect, it } from "vitest";
import { PLUGIN_CATALOG } from "@/lib/local/plugin-catalog";
import { hostComposition } from "@/server/composition";
import { apiRoutePlugins } from "@/server/routes";

describe("插件目录", () => {
  it("id 唯一", () => {
    const ids = PLUGIN_CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("覆盖全部组合条目（宿主 + 路由；AI 面板不属于插件）", () => {
    const actual = [
      // http-routes 是 kernel 运行时条目，不在 hostComposition 里
      "http-routes",
      ...hostComposition().map((entry) => entry.id),
      ...apiRoutePlugins().map((entry) => entry.id),
    ];
    const catalogIds = new Set(PLUGIN_CATALOG.map((entry) => entry.id));
    const missing = actual.filter((id) => !catalogIds.has(id));
    expect(missing, `这些组合条目缺少插件元数据：${missing.join("、")}`).toEqual([]);
  });

  it("核心插件都标了 core，动态通道默认关闭", () => {
    const core = PLUGIN_CATALOG.filter((entry) => entry.core).map((entry) => entry.id);
    expect(core).toEqual(
      expect.arrayContaining(["http-routes", "tools-registry", "settings-file", "doc-store-sqlite", "plugin-manager"]),
    );
    expect(PLUGIN_CATALOG.find((entry) => entry.id === "dynamic-plugins")?.defaultEnabled).toBe(false);
  });

  it("AI 助手不是插件，内置 UI 插件清单为空", () => {
    expect(PLUGIN_CATALOG.find((entry) => entry.id === "ui-ai-panel")).toBeUndefined();
    expect(PLUGIN_CATALOG.filter((entry) => entry.scope === "ui")).toHaveLength(0);
  });

});
