// 三栏 shell 让步链求解器单测（lib/layout/columns.ts）
import { describe, it, expect } from "vitest";
import {
  computeColumns,
  clampWidth,
  CENTER_MIN,
  DETAILS_DEFAULT,
  DETAILS_MAX,
  DETAILS_MIN,
  SIDEBAR_AUTO_COLLAPSE,
  SIDEBAR_COLLAPSED,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
} from "@/lib/layout/columns";

describe("lib/layout/columns clampWidth", () => {
  it("把宽度夹进范围并取整", () => {
    expect(clampWidth(100, 264, 420)).toBe(264);
    expect(clampWidth(500, 264, 420)).toBe(420);
    expect(clampWidth(300.6, 264, 420)).toBe(301);
    expect(clampWidth(320, 264, 420)).toBe(320);
  });
});

describe("lib/layout/columns computeColumns", () => {
  it("视口足够时三列按偏好宽度解析", () => {
    const cols = computeColumns(1600, SIDEBAR_DEFAULT, DETAILS_DEFAULT);
    expect(cols.sidebar).toBe(SIDEBAR_DEFAULT);
    expect(cols.details).toBe(DETAILS_DEFAULT);
    expect(cols.center).toBe(1600 - SIDEBAR_DEFAULT - DETAILS_DEFAULT);
  });

  it("关闭的 sidebar 解析为固定 rail 宽，details 解析为 0", () => {
    const cols = computeColumns(1600, 0, 0);
    expect(cols.sidebar).toBe(SIDEBAR_COLLAPSED);
    expect(cols.details).toBe(0);
    expect(cols.center).toBe(1600 - SIDEBAR_COLLAPSED);
  });

  it("偏好越界时重新夹取", () => {
    const cols = computeColumns(1600, 10, 9999);
    expect(cols.sidebar).toBe(SIDEBAR_MIN);
    expect(cols.details).toBe(DETAILS_MAX);
  });

  it("空间不足先压缩 details 到下限，中心保持 CENTER_MIN", () => {
    // 280 + 360 + 640 = 1280 能放下；压缩场景：视口 = 280 + 640 + 320（details 需压到 320）
    const cols = computeColumns(280 + CENTER_MIN + 320, SIDEBAR_DEFAULT, DETAILS_DEFAULT);
    expect(cols.center).toBe(CENTER_MIN);
    expect(cols.details).toBe(320);
    expect(cols.sidebar).toBe(SIDEBAR_DEFAULT);
  });

  it("仍放不下时自动关闭 details，中心兜底吸收缺口", () => {
    // 视口 = sidebar + 400：details 无位可让，直接关闭
    const cols = computeColumns(SIDEBAR_DEFAULT + 400, SIDEBAR_DEFAULT, DETAILS_DEFAULT);
    expect(cols.details).toBe(0);
    expect(cols.sidebar).toBe(SIDEBAR_DEFAULT);
    expect(cols.center).toBe(400);
  });

  it("sidebar 永不让步：任何视口下都解析为偏好或 rail", () => {
    const cols = computeColumns(300, SIDEBAR_DEFAULT, 0);
    expect(cols.sidebar).toBe(SIDEBAR_DEFAULT);
    expect(cols.center).toBe(20);
    expect(cols.details).toBe(0);
  });

  it("中心列最低兜底不低于 0", () => {
    const cols = computeColumns(100, SIDEBAR_DEFAULT, 0);
    expect(cols.sidebar).toBe(SIDEBAR_DEFAULT);
    expect(cols.center).toBe(0);
  });

  it("已关闭的 details 在窄视口下保持关闭，不产生负宽", () => {
    const cols = computeColumns(600, SIDEBAR_DEFAULT, 0);
    expect(cols.details).toBe(0);
    expect(cols.center).toBe(600 - SIDEBAR_DEFAULT);
  });

  it("常量契约：默认/上下限/断点与 DSH 一致", () => {
    expect(SIDEBAR_MIN).toBe(264);
    expect(SIDEBAR_MAX).toBe(420);
    expect(SIDEBAR_DEFAULT).toBe(280);
    expect(SIDEBAR_COLLAPSED).toBe(56);
    expect(SIDEBAR_AUTO_COLLAPSE).toBe(1024);
    expect(DETAILS_MIN).toBe(300);
    expect(DETAILS_MAX).toBe(520);
    expect(DETAILS_DEFAULT).toBe(360);
    expect(CENTER_MIN).toBe(640);
  });
});
