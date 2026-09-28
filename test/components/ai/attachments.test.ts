// @vitest-environment jsdom
// AI 面板附件：校验规则（与服务端 normalizeAttachments 同规则）+ 读取。
import { describe, it, expect } from "vitest";
import {
  ATTACHMENT_MAX_CHARS,
  ATTACHMENT_MAX_COUNT,
  isTextAttachmentName,
  readAttachmentFile,
  validateAttachments,
} from "@/src/shell/ai/attachments";

describe("isTextAttachmentName", () => {
  it("放行文本类扩展名与无扩展名文件", () => {
    for (const name of ["a.md", "b.TXT", "c.json", "d.csv", "README", ".env"]) {
      expect(isTextAttachmentName(name), name).toBe(true);
    }
  });

  it("拒绝二进制/图片", () => {
    for (const name of ["a.png", "b.pdf", "c.docx", "d.zip"]) {
      expect(isTextAttachmentName(name), name).toBe(false);
    }
  });
});

describe("validateAttachments", () => {
  it("接受合法附件并截断超长内容", () => {
    const long = "字".repeat(ATTACHMENT_MAX_CHARS + 100);
    const { accepted, rejected } = validateAttachments([{ name: "长.md", content: long }], 0);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].content).toHaveLength(ATTACHMENT_MAX_CHARS);
    expect(rejected[0].reason).toContain("已截断");
  });

  it("超过数量上限时拒绝多余的（含已有附件计数）", () => {
    const list = Array.from({ length: 3 }, (_, i) => ({ name: `f${i}.md`, content: "内容" }));
    const { accepted, rejected } = validateAttachments(list, ATTACHMENT_MAX_COUNT - 1);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    expect(rejected[0].reason).toContain("最多");
  });

  it("拒绝非文本文件与空文件（逐条给出原因，不整体失败）", () => {
    const { accepted, rejected } = validateAttachments(
      [
        { name: "图.png", content: "binary" },
        { name: "空.md", content: "   " },
        { name: "好的.md", content: "正文" },
      ],
      0,
    );
    expect(accepted.map((a) => a.name)).toEqual(["好的.md"]);
    expect(rejected.map((r) => r.name)).toEqual(["图.png", "空.md"]);
  });
});

describe("readAttachmentFile", () => {
  it("读出文件文本", async () => {
    const file = new File(["# 标题\n内容"], "note.md", { type: "text/markdown" });
    await expect(readAttachmentFile(file)).resolves.toEqual({ name: "note.md", content: "# 标题\n内容" });
  });
});
