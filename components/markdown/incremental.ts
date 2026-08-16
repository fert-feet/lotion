// 对齐 DSH（deepseek-harness packages/client/ui-primitives/src/markdown/incremental.ts）：
// 追加式文本流的增量块级 markdown 解析——流式 chunk 到达时全文重解析是回复长度的平方级；
// CommonMark 块解析按行进行，追加文本只会重塑解析前沿（最后一块：段落变 setext 标题或表格、
// 空行后列表延续、未闭合围栏吞行），因此除末尾两块之外的早期块已定型。
// 本解析器冻结除末尾 UNSTABLE_TAIL_BLOCKS 块之外的全部块，只重解析其后源文本：
// 每个源区域在整个流上只解析 O(1) 次，而非每个 chunk 一次。

import type { Root, RootContent } from "mdast";

/** 保留不稳定的尾部块数。追加文本至多重塑最后一块；倒数第二块是安全余量。 */
const UNSTABLE_TAIL_BLOCKS = 2;

/** 顶层 mdast 块 + 跨 chunk 稳定的渲染 key。 */
export interface PositionedBlock {
  /** 解析出的块。内部位置相对其解析切片。 */
  readonly node: RootContent;
  /** 块在完整源文本中的起始偏移。自首次出现到冻结期间稳定，React 可协调而非重挂载。 */
  readonly key: number;
}

/** {@link IncrementalMarkdownParser.update} 的返回。 */
export interface IncrementalBlocks {
  /** 不会再变化的块；随 generation 单调增长。 */
  readonly frozen: readonly PositionedBlock[];
  /** 重新解析的不稳定尾部（至多 UNSTABLE_TAIL_BLOCKS 块加上增长）。 */
  readonly tail: readonly PositionedBlock[];
  /** 非追加输入丢弃冻结前缀时自增；调用方据此丢弃以它做 key 的缓存。 */
  readonly generation: number;
}

/** 块渲染 key：其在源文本中的绝对起始偏移。无位置节点回退为负的列表索引 key。 */
function blockKey(node: RootContent, base: number, index: number): number {
  const offset = node.position?.start.offset;
  return offset === undefined ? -(index + 1) : base + offset;
}

/**
 * 追加式增量解析器，接受调用方提供的语法（与渲染端共享，保证块边界一致）。
 * 一个实例累积一篇流式文档；非追加输入会重置它。
 */
export class IncrementalMarkdownParser {
  private prevText = "";
  private tailStart = 0;
  private frozen: PositionedBlock[] = [];
  private generation = 0;
  private cached: IncrementalBlocks | null = null;

  /** @param parse - 与渲染端共享的语法，块边界保持一致。 */
  constructor(private readonly parse: (text: string) => Root) {}

  /**
   * 折叠当前累积文本，返回冻结/尾部切分。对相同输入幂等（直接返回上次结果），
   * 调用方可以从会重执行的渲染路径调用。
   * @param text - 完整累积的 markdown 源。
   * @returns 带流稳定渲染 key 的冻结块与尾部块。
   */
  update(text: string): IncrementalBlocks {
    if (this.cached !== null && text === this.prevText) return this.cached;
    // 每次更新做 O(前缀) 的 memcmp：可靠的发散检测必须校验整个保留前缀，
    // 而 startsWith 按字节比较比解析快两个数量级——本类存在的意义就是省去解析。
    // 传 append/reset 增量会把簿记推到会话投影更新边界之外，换取对现实回复
    // 尺寸仍亚毫秒的检查，不划算。
    if (!text.startsWith(this.prevText)) {
      this.prevText = "";
      this.tailStart = 0;
      this.frozen = [];
      this.generation += 1;
    }
    this.prevText = text;
    const base = this.tailStart;
    const blocks = this.parse(text.slice(base)).children;
    let firstUnstable = Math.max(0, blocks.length - UNSTABLE_TAIL_BLOCKS);
    if (firstUnstable > 0) {
      const cutEnd = blocks[firstUnstable - 1]?.position?.end.offset;
      if (cutEnd === undefined) {
        // 语法省略位置则无处可切；整段保留在尾部，而不是猜测边界。
        firstUnstable = 0;
      } else {
        for (const node of blocks.slice(0, firstUnstable)) {
          this.frozen.push({ node, key: blockKey(node, base, this.frozen.length) });
        }
        this.tailStart = base + cutEnd;
      }
    }
    const tail = blocks.slice(firstUnstable).map((node, index) => ({
      node,
      key: blockKey(node, base, index),
    }));
    this.cached = { frozen: [...this.frozen], tail, generation: this.generation };
    return this.cached;
  }
}
