// 启动审计：把 AuditReport 渲染成人类可读的多行文本。
//
// 为什么必须有它（DSH 的教训，docs/cordis-tutorial/06:70-82）：
// `inject` 门控失败时插件停在 PENDING —— 这是**合法状态**，插件不会报错、不会崩，
// 只是永远不干活。没有审计就等于"插件静默消失"。
import type { AuditReport } from "./context";

/** 把审计报告渲染成多行文本（无问题时返回成功摘要） */
export function formatAudit(report: AuditReport): string {
  const lines: string[] = [];
  lines.push(
    `[kernel] 已装配 ${report.fibers} 个 fiber · ${report.services.length} 个服务 · ${report.listeners} 个监听器`,
  );
  if (report.failed.length > 0) {
    lines.push(`[kernel] ✗ ${report.failed.length} 个插件激活失败：`);
    for (const item of report.failed) lines.push(`    - ${item.name}：${item.error}`);
  }
  if (report.pending.length > 0) {
    lines.push(`[kernel] ⚠ ${report.pending.length} 个插件处于 PENDING（缺少服务，不会工作）：`);
    for (const item of report.pending) {
      lines.push(`    - ${item.name}：等待 ${item.missing.join("、")}`);
    }
  }
  return lines.join("\n");
}

/** 是否一切就绪（无 PENDING、无 FAILED） */
export function auditOk(report: AuditReport): boolean {
  return report.pending.length === 0 && report.failed.length === 0;
}
