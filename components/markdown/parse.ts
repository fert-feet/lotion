// 对齐 DSH（deepseek-harness packages/client/ui-primitives/src/markdown/parse.ts）：
// mdast 语法——GFM + CJK 友好加粗。Lotion 不渲染数学公式，故不引入 math 扩展
// （DSH 的 settled 语法是 streaming 语法加 math；此处两臂同一语法，天然一致）。

import type { Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { cjkFriendlyStrong } from "./cjkFriendlyStrong";

/**
 * 解析 GFM markdown（表格/删除线/任务列表 + CJK 友好加粗）。
 * @param text - Markdown 源文本。
 * @returns mdast root。
 */
export function parseGfm(text: string): Root {
  return fromMarkdown(text, {
    extensions: [gfm(), cjkFriendlyStrong()],
    mdastExtensions: [gfmFromMarkdown()],
  });
}
