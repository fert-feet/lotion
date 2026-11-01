// 动态插件持久化：定义/审批状态落盘，运行状态不跨重启恢复。
import { describe, expect, it } from "vitest";
import { createRootContext } from "@/lib/kernel";
import type { DynamicPersistence, DynamicRecord } from "@/lib/seams/dynamic";
import { createDynamicRunner } from "@/lib/dynamic/runner";

function memoryPersistence(initial: DynamicRecord[] = []) {
  const records = new Map(initial.map((record) => [record.definition.id, { ...record }]));
  const persistence: DynamicPersistence & { records: Map<string, DynamicRecord> } = {
    records,
    load: () => [...records.values()].map((record) => ({ ...record })),
    save: (record) => {
      records.set(record.definition.id, {
        definition: record.definition,
        state: record.state,
        ...(record.note ? { note: record.note } : {}),
      });
    },
    remove: (id) => {
      records.delete(id);
    },
  };
  return persistence;
}

const HOST_CODE = "harness.define({ name: 'demo', apply() {} })";
const CLIENT_CODE = "harness.define({ name: 'demo-client', apply() {} })";

describe("动态插件持久化", () => {
  it("define 落盘；重启后定义还在但运行状态归为 stopped", async () => {
    const persistence = memoryPersistence();
    const first = createDynamicRunner({
      ctx: createRootContext(),
      persistence,
      allowedServices: ["tools"],
    });

    first.define({ title: "日报生成器", host: HOST_CODE });
    await first.run("dyn-1");
    expect(first.get("dyn-1")?.state).toBe("running");
    expect(persistence.records.get("dyn-1")?.state).toBe("running");

    // 模拟进程重启：新的 runner 读同一份持久化
    const second = createDynamicRunner({
      ctx: createRootContext(),
      persistence,
      allowedServices: ["tools"],
    });
    const restored = second.get("dyn-1");
    expect(restored?.definition.title).toBe("日报生成器");
    expect(restored?.state).toBe("stopped");
    expect(second.runningIds()).toEqual([]);
    // 归位后的状态也写回，避免下次启动反复修正
    expect(persistence.records.get("dyn-1")?.state).toBe("stopped");
  });

  it("审批状态跨重启保留（客户端半边仍需批准一次）", () => {
    const persistence = memoryPersistence();
    const first = createDynamicRunner({ ctx: createRootContext(), persistence });
    first.define({ title: "客户端插件", client: CLIENT_CODE });
    first.approve("dyn-1");
    expect(first.get("dyn-1")?.state).toBe("approved");

    const second = createDynamicRunner({ ctx: createRootContext(), persistence });
    expect(second.get("dyn-1")?.state).toBe("approved");
  });

  it("undefine 删除定义与持久化文件", async () => {
    const persistence = memoryPersistence();
    const runner = createDynamicRunner({ ctx: createRootContext(), persistence });
    runner.define({ title: "临时插件", host: HOST_CODE });

    await runner.undefine("dyn-1");
    expect(runner.get("dyn-1")).toBeUndefined();
    expect(persistence.records.has("dyn-1")).toBe(false);
  });

  it("恢复后 id 计数继续递增，不会覆盖已有定义", () => {
    const persistence = memoryPersistence([
      {
        definition: {
          id: "dyn-7",
          title: "旧插件",
          host: HOST_CODE,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        state: "defined",
      },
    ]);
    const runner = createDynamicRunner({ ctx: createRootContext(), persistence });
    const next = runner.define({ title: "新插件", host: HOST_CODE });
    expect(next.definition.id).toBe("dyn-8");
  });
});
