// 应用级 BlockNote schema（P1，对标 Notion）：
// - 在默认 schema 上扩展自定义块（Callout）
// - 客户端编辑器（useCreateBlockNote）与服务端 server-util（content-server.ts）共享同一 schema，
//   保证 JSON 读写 / Markdown 转换对自定义块一致
// - Callout 用 DOM 渲染（非 React）：ProseMirror nodeView（浏览器）与
//   ServerBlockNoteEditor（JSDOM）都能执行 render/toExternalHTML/parse

import { BlockNoteSchema, createBlockSpec, createInlineContentSpec, createCodeBlockSpec } from "@blocknote/core";
import { codeBlockOptions } from "@blocknote/code-block";

/**
 * Callout（提示框）块：emoji 图标 + 浅色圆角底 + 内联富文本。
 * 对标 Notion 的 Callout 块；DOM 结构带 .lotion-callout 类，样式见
 * components/editor/blocknote.css。
 */
const createCalloutBlock = createBlockSpec(
  {
    type: "callout",
    propSchema: {
      icon: { default: "💡" },
    },
    content: "inline",
  },
  {
    render: (block) => {
      const wrapper = document.createElement("div");
      wrapper.className = "lotion-callout";
      const icon = document.createElement("span");
      icon.className = "lotion-callout-icon";
      icon.setAttribute("contenteditable", "false");
      icon.textContent = block.props.icon || "💡";
      const content = document.createElement("div");
      content.className = "lotion-callout-content";
      wrapper.appendChild(icon);
      wrapper.appendChild(content);
      return { dom: wrapper, contentDOM: content };
    },
    // 粘贴/导入：识别 .lotion-callout 结构，取回 icon prop
    parse: (el) => {
      if (!el.classList.contains("lotion-callout")) return undefined;
      const iconEl = el.querySelector(".lotion-callout-icon");
      return { icon: iconEl?.textContent?.trim() || "💡" };
    },
    // 复制到外部 / markdown 导出：与渲染结构一致（contentDOM 承载文本）
    toExternalHTML: (block) => {
      const wrapper = document.createElement("div");
      wrapper.className = "lotion-callout";
      const icon = document.createElement("span");
      icon.className = "lotion-callout-icon";
      icon.textContent = block.props.icon || "💡";
      const content = document.createElement("div");
      content.className = "lotion-callout-content";
      wrapper.appendChild(icon);
      wrapper.appendChild(content);
      return { dom: wrapper, contentDOM: content };
    },
  },
);

/**
 * Mention（@提及文档）内联内容：点击跳转到对应文档，对标 Notion 的 @ 引用。
 * DOM 渲染（非 React），客户端/服务端共享；结构带 .lotion-mention 类 + data-id。
 */
const createMentionSpec = createInlineContentSpec(
  {
    type: "mention",
    propSchema: {
      id: { default: "" },
      title: { default: "" },
    },
    content: "none",
  },
  {
    render: (inlineContent) => {
      const span = document.createElement("span");
      span.className = "lotion-mention";
      span.setAttribute("contenteditable", "false");
      span.dataset.id = inlineContent.props.id;
      span.textContent = "@" + inlineContent.props.title;
      // 点击跳转对应文档（本地单机版：整页导航）
      span.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (inlineContent.props.id) {
          window.location.href = `/documents/${inlineContent.props.id}`;
        }
      });
      return { dom: span };
    },
    parse: (el) => {
      if (!el.classList.contains("lotion-mention")) return undefined;
      return {
        id: el.getAttribute("data-id") || "",
        title: el.textContent?.replace(/^@/, "").trim() || "",
      };
    },
    toExternalHTML: (inlineContent) => {
      const span = document.createElement("span");
      span.className = "lotion-mention";
      span.dataset.id = inlineContent.props.id;
      span.textContent = "@" + inlineContent.props.title;
      return { dom: span };
    },
  },
);

/** 具体 schema 实例与类型：编辑器据此获得含 callout/mention/代码高亮的完整类型 */
export const lotionSchema = BlockNoteSchema.create().extend({
  blockSpecs: {
    callout: createCalloutBlock(),
    // 代码块支持语言集（配合编辑器 extensions 里的 syntaxHighlighter 渲染高亮）
    codeBlock: createCodeBlockSpec(codeBlockOptions),
  },
  inlineContentSpecs: {
    mention: createMentionSpec,
  },
});
export type LotionSchema = typeof lotionSchema;

/** 返回共享 schema 单例（客户端编辑器 / 服务端转换共用同一实例） */
export function createLotionSchema(): LotionSchema {
  return lotionSchema;
}
