// 对齐 DSH（deepseek-harness packages/client/ui-primitives/src/markdown/cjkFriendlyStrong.ts）：
// 让星号加粗在 CJK 行文中标点后也能闭合（CommonMark 默认要求 * 后不能紧跟非空白）。

import { attention } from "micromark-core-commonmark";
import { unicodePunctuation } from "micromark-util-character";
import { classifyCharacter } from "micromark-util-classify-character";
import { codes, constants } from "micromark-util-symbol";
import type { Construct, Extension, State, Tokenizer } from "micromark-util-types";

const cjkCharacter = new RegExp(
  [
    "\\p{Script_Extensions=Han}",
    "\\p{Script_Extensions=Hiragana}",
    "\\p{Script_Extensions=Katakana}",
    "\\p{Script_Extensions=Hangul}",
    "\\p{Script_Extensions=Bopomofo}",
  ].join("|"),
  "u",
);

function isCjkCharacter(code: number | null): boolean {
  return code !== null && code >= 0 && cjkCharacter.test(String.fromCodePoint(code));
}

const tokenizeCjkFriendlyAttention: Tokenizer = function (effects, ok, nok) {
  const configuredAttentionMarkers = this.parser.constructs.attentionMarkers.null;
  if (configuredAttentionMarkers === undefined) {
    throw new Error("micromark CommonMark attention markers are unavailable");
  }
  const attentionMarkers = configuredAttentionMarkers;
  const previous = this.previous;
  const before = classifyCharacter(previous);
  let marker: number | null = codes.eof;

  return start;

  function start(code: number | null): State | undefined {
    /* v8 ignore next -- this text construct is dispatched only for an asterisk. */
    if (code !== codes.asterisk) return nok(code);
    marker = code;
    effects.enter("attentionSequence");
    return inside(code);
  }

  function inside(code: number | null): State | undefined {
    if (code === marker) {
      effects.consume(code);
      return inside;
    }

    const token = effects.exit("attentionSequence");
    const after = classifyCharacter(code);
    const open =
      !after ||
      (after === constants.characterGroupPunctuation && Boolean(before)) ||
      attentionMarkers.includes(code);
    const commonMarkClose =
      !before ||
      (before === constants.characterGroupPunctuation && Boolean(after)) ||
      attentionMarkers.includes(previous);
    const markerCount = token.end.offset - token.start.offset;
    const cjkStrongClose = markerCount >= 2 && unicodePunctuation(previous) && isCjkCharacter(code);
    const close = commonMarkClose || cjkStrongClose;

    token._open = open;
    token._close = close;
    return ok(code);
  }
};

const cjkFriendlyAttention: Construct = {
  name: "cjkFriendlyAttention",
  resolveAll: attention.resolveAll,
  tokenize: tokenizeCjkFriendlyAttention,
};

const cjkFriendlyStrongExtension: Extension = {
  text: { [codes.asterisk]: cjkFriendlyAttention },
};

/**
 * 扩展 CommonMark 星号加粗：允许标点分隔的中文行文中闭合（作为 fromMarkdown 的 micromark 语法扩展）。
 */
export function cjkFriendlyStrong(): Extension {
  return cjkFriendlyStrongExtension;
}
