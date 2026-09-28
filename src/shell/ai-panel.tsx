"use client";

// AI 面板（details 列）——DSH 风格 turn 时间线：
// 一轮用户输入 = 一个 Turn（用户气泡 + 有序 part 序列 + 引用 + footer），
// SSE 事件按到达顺序归组渲染（状态流转见 ./ai/turn-reducer.ts，纯逻辑已抽出去可测）。
//
// 本组件只负责 I/O 与编排：请求生命周期、队列调度、滚动、确认/提问的回填。
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Bot, FileText, History, Loader2, Paperclip, Plus, Send, Sparkles, Square, X } from "@/components/icons";
import { toast } from "sonner";
import { useLayout } from "@/hooks/use-layout";
import { useUser } from "@/hooks/use-user";
import { useRefresh } from "@/hooks/use-refresh";
import type { ChatSession } from "@/lib/seams/doc-store";
import { useActor, useDocStore } from "@/src/kernel/react";
import MentionInput, { type MentionInputHandle } from "./mention-input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { createTurn, type Question, type SseEvent, type Turn } from "./ai/types";
import {
  applyTurnEvent,
  createQueuedMessage,
  enqueue,
  finalizeTurn,
  markDraftResolved,
  markNoteResolved,
  markQuestionAnswered,
  pendingDeleteIds,
  pendingDraftIds,
  rebuildTurns,
  removeQueueAt,
  shouldDispatchQueued,
  takeNextForSession,
  type QueuedMessage,
} from "./ai/turn-reducer";
import { TurnView } from "./ai/turn";
import { SessionMenu } from "./ai/session-menu";
import { filterSessionsByScope, recentUserMessages, stepRecallIndex } from "./ai/session-utils";
import {
  ATTACHMENT_EXTENSIONS,
  readAttachmentFile,
  validateAttachments,
  type ChatAttachment,
} from "./ai/attachments";

/** 粘底判定阈值：距底小于该值就算"跟到底部" */
const STICK_THRESHOLD_PX = 80;

/** 历史分页大小（每次「加载更早」再多拉这么多条） */
const HISTORY_PAGE = 40;

/** AI 建完笔记后跳转的延迟：让本轮叙述先落屏，再带用户去看新文档 */
const NAVIGATE_DELAY_MS = 500;

const AiPanel = () => {
  const docStore = useDocStore();
  const actor = useActor();
  // details 列由布局 store 控制：0 宽 = 关闭（保持挂载），>0 = 打开
  const detailsOpen = useLayout((s) => s.details > 0);
  const closeDetails = useLayout((s) => s.closeDetails);
  const { user } = useUser();
  const triggerSidebar = useRefresh((s) => s.triggerSidebar);
  const triggerDocument = useRefresh((s) => s.triggerDocument);
  const params = useParams();
  const navigate = useNavigate();

  // ---- 会话状态 ----
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  // 会话作用域：全部 / 只看本文档 / 只看全局（会话可绑定到某篇文档）
  const [sessionScope, setSessionScope] = useState<"all" | "document">("all");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // ---- turn 时间线 ----
  const [turns, setTurns] = useState<Turn[]>([]);
  // 当前流式回合（reducer 就地改该对象，commit 触发渲染）
  const currentTurnRef = useRef<Turn | null>(null);
  // 流式文本节流句柄（rAF 为主，定时器兜底）
  const textRaf = useRef<number | null>(null);
  const textTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 流式请求控制：当前是否在生成、终止用 AbortController、待发送队列（含会话快照）
  const streamingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<QueuedMessage[]>([]);
  /** 用户显式「停止生成」后置位：不再自动续发队列（点「继续发送」才恢复） */
  const queueSuppressedRef = useRef(false);
  const [queueSuppressed, setQueueSuppressed] = useState(false);
  const [queueItems, setQueueItems] = useState<QueuedMessage[]>([]);
  const [inputEmpty, setInputEmpty] = useState(true);
  // 历史分页：一次拉最近 HISTORY_PAGE 条；更早的按需加载（长会话不再一次性全量拉取）
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE);
  const historySessionRef = useRef<string | null>(null);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  // 待发送附件（文本类）：随下一条消息发出
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const mentionRef = useRef<MentionInputHandle>(null);
  // 当前激活会话 ref：abort 分支区分"用户手动停止"与"切换会话导致的中止"
  const activeSessionRef = useRef<string | null>(null);
  activeSessionRef.current = activeSessionId;

  const userId = user?.id;

  // turns 的最新值（稳定回调里读取，避免闭包过期）
  const turnsRef = useRef<Turn[]>([]);
  turnsRef.current = turns;

  /** 立即提交（工具/副作用事件）。
   *
   *  ⚠️ 两个必须记住的坑（都踩过）：
   *  1) 不做"已卸载"门控：React 18 起对已卸载组件 setState 是安全空操作，而这道门控
   *     一旦误判就会让整轮流式文本再也不渲染；
   *  2) reducer 是**原地改** turn 对象的（热路径省分配），而 `<TurnView>` 是 memo 的 ——
   *     只把数组换个引用、turn 引用不变，浅比较会判定"props 没变"直接跳过重渲染，
   *     症状就是"服务端 2 秒答完，界面一直『正在思考』，刷新后才看到回答"。
   *     所以这里把当前流式回合换成浅拷贝：历史回合保持原引用（继续跳过重渲染），
   *     正在长的这一轮拿到新身份（正常重渲染）。 */
  const commit = useCallback(() => {
    const current = currentTurnRef.current;
    if (!current) {
      setTurns((prev) => [...prev]);
      return;
    }
    const next = { ...current };
    currentTurnRef.current = next;
    setTurns((prev) => prev.map((t) => (t === current ? next : t)));
  }, []);

  /** 流式文本提交（每帧最多一次；**带定时器兜底**）。
   *  后台标签页里 rAF 会被浏览器暂停，只挂 rAF 会让 textRaf 永远非 null，
   *  之后所有文本提交都被节流吞掉（回到前台也补不回来）。 */
  const commitText = useCallback(() => {
    if (textRaf.current !== null || textTimer.current !== null) return;
    const flush = () => {
      if (textRaf.current !== null) cancelAnimationFrame(textRaf.current);
      if (textTimer.current !== null) clearTimeout(textTimer.current);
      textRaf.current = null;
      textTimer.current = null;
      commit();
    };
    textRaf.current = requestAnimationFrame(flush);
    textTimer.current = setTimeout(flush, 120);
  }, [commit]);

  // 卸载收尾：取消飞行中的 rAF / 定时器
  useEffect(() => {
    return () => {
      if (textRaf.current !== null) cancelAnimationFrame(textRaf.current);
      if (textTimer.current !== null) clearTimeout(textTimer.current);
    };
  }, []);

  // ---- 发送（先声明 ref，供队列调度与稳定回调引用最新闭包）----
  const sendMessageRef = useRef<
    (content: string, sessionId: string, attachments?: ChatAttachment[]) => Promise<void>
  >(async () => {});

  /** 队列调度：只取**当前激活会话**的待发消息；用户点过停止后不自动续发 */
  const drainQueue = useCallback(() => {
    if (!shouldDispatchQueued(
      { streaming: streamingRef.current, suppressed: queueSuppressedRef.current },
      queueRef.current,
      activeSessionRef.current,
    )) return;
    const { item, rest } = takeNextForSession(queueRef.current, activeSessionRef.current);
    if (!item) return;
    queueRef.current = rest;
    setQueueItems(rest);
    setTimeout(() => { void sendMessageRef.current(item.content, item.sessionId); }, 60);
  }, []);

  // 初始化：加载会话列表；无会话时自动创建一个（全局对话，不绑定文档）
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    docStore.listChatSessions({ userId })
      .then(async (list) => {
        if (!alive) return;
        let sessionsList = list;
        if (sessionsList.length === 0) {
          await docStore.createChatSession({ userId }, undefined, params.documentId ?? null);
          sessionsList = await docStore.listChatSessions({ userId });
        }
        if (!alive) return;
        setSessions(sessionsList);
        setActiveSessionId(sessionsList[0].id);
      })
      .catch(() => {
        // 拉取失败不阻塞，保持空状态
      });
    return () => { alive = false; };
    // 首次进入只跑一次（含当前文档绑定），避免每次路由变化都重建会话
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, docStore]);

  // 切换会话时加载该会话的历史（跨文档全局对话）→ 重建 turn 时间线
  useEffect(() => {
    if (!userId || !activeSessionId) return;
    // 切换会话：中止上一会话的流式请求，防止旧流的文本/loading 污染新会话
    if (streamingRef.current && abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      streamingRef.current = false;
      setLoading(false);
    }
    let alive = true;
    // 只有切换会话才清空时间线；「加载更早」（historyLimit 变化）保留当前视图
    if (historySessionRef.current !== activeSessionId) {
      historySessionRef.current = activeSessionId;
      currentTurnRef.current = null;
      setTurns([]);
    }
    docStore.listChatHistory({ userId }, activeSessionId, historyLimit)
      .then(async (msgs) => {
        if (!alive) return;
        const rebuilt = rebuildTurns(msgs);
        setTurns(rebuilt);
        setHasMoreHistory(msgs.length >= historyLimit);
        // 对账：已确认删除的文档不在了 → 卡片显示为"已删除"，不再弹一张点了必然报错的确认卡
        const gone = (await Promise.all(
          pendingDeleteIds(rebuilt).map(async (noteId) => {
            try {
              return (await docStore.getById(actor, noteId)) === null ? noteId : null;
            } catch {
              return null; // 读失败不当成"已删除"
            }
          }),
        )).filter((id): id is string => !!id);

        // 对账（AI 草稿）：文档没了 = 已丢弃；isDraft=false = 已确认保存。
        // 这样"确认"这件事在对话栏里就有终态，不必回文档里看横幅。
        const draftStates = await Promise.all(
          pendingDraftIds(rebuilt).map(async (noteId) => {
            try {
              const doc = await docStore.getById(actor, noteId);
              if (doc === null) return { noteId, resolved: "discarded" as const };
              if (doc.isDraft === false) return { noteId, resolved: "saved" as const };
              return null;
            } catch {
              return null;
            }
          }),
        );
        const drafts = draftStates.filter((d): d is { noteId: string; resolved: "saved" | "discarded" } => !!d);

        if (!alive || (gone.length === 0 && drafts.length === 0)) return;
        setTurns((prev) => {
          let next = gone.reduce((acc, noteId) => markNoteResolved(acc, "delete_confirm", noteId), prev);
          for (const d of drafts) next = markDraftResolved(next, d.noteId, d.resolved);
          return next;
        });
      })
      .catch(() => {
        // 历史拉取失败不阻塞，保持空对话
      })
      .finally(() => {
        // 回到本会话时把属于它的排队消息接着发出去（另一端 drainQueue 只在发送结束时调度）
        if (alive) drainQueue();
      });
    return () => { alive = false; };
  }, [userId, activeSessionId, docStore, actor, drainQueue, historyLimit]);

  // 切会话时把分页窗口复位（否则新会话仍按上一个会话加载过的深度拉取）
  useEffect(() => {
    setHistoryLimit(HISTORY_PAGE);
  }, [activeSessionId]);

  // 自愈：loading 已结束却还有 running 的回合（请求被新请求接管 / 异常路径漏收尾 /
  // 标签页休眠导致回调丢失）→ 就地收尾，绝不留下"永远正在思考"
  useEffect(() => {
    if (loading) return;
    setTurns((prev) => {
      if (!prev.some((t) => t.status === "running")) return prev;
      return prev.map((t) => {
        if (t.status !== "running") return t;
        const settled = { ...t };
        finalizeTurn(settled, "done");
        return settled;
      });
    });
  }, [loading]);

  // ---- 滚动：粘底才跟随（原来无条件 scrollTo 底部，用户上翻读历史会被每帧打断）----
  const messagesRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = messagesRef.current;
    if (!el) return;
    // 防御：`Element.scrollTo` 在 jsdom / 老 WebView 里不存在，直接调用会抛错，
    // 而被动 effect 里抛错会被错误边界接管 —— 整个 AI 面板消失（不能赌环境）
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
    stickToBottomRef.current = true;
    setShowJumpToBottom(false);
  }, []);

  const onMessagesScroll = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distance < STICK_THRESHOLD_PX;
    stickToBottomRef.current = atBottom;
    setShowJumpToBottom((prev) => (prev === !atBottom ? prev : !atBottom));
  }, []);

  // 打开面板 / 新内容落地时，只有"仍贴底"才自动跟随，否则显示"回到底部"
  useEffect(() => {
    if (!detailsOpen) return;
    if (stickToBottomRef.current) scrollToBottom();
  }, [detailsOpen, turns, scrollToBottom]);

  // ---- 会话操作 ----

  const refreshSessions = useCallback(() => {
    if (!user) return;
    docStore.listChatSessions({ userId: user.id })
      .then((list) => { setSessions(list); })
      .catch(() => {});
  }, [user, docStore]);

  const handleNewSession = async () => {
    if (!user) return;
    // 当前激活的已是空的新对话（标题未被自动命名 = 从未发过消息），不重复创建
    const active = sessions.find((s) => s.id === activeSessionId);
    if (active?.title === "新对话") return;
    try {
      const id = await docStore.createChatSession({ userId: user.id }, undefined, params.documentId ?? null);
      setSessions((prev) => [
        { id, title: "新对话", createdAt: "", updatedAt: "", documentId: params.documentId ?? null },
        ...prev,
      ]);
      setActiveSessionId(id);
      setTurns([]);
    } catch {
      toast.error("创建会话失败");
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!user) return;
    try {
      await docStore.deleteChatSession({ userId: user.id }, sessionId);
      const next = sessions.filter((s) => s.id !== sessionId);
      setSessions(next);
      if (activeSessionId === sessionId) {
        // 删除的是当前会话：激活下一个，没有则新建
        if (next.length > 0) {
          setActiveSessionId(next[0].id);
        } else {
          const id = await docStore.createChatSession({ userId: user.id });
          setSessions([{ id, title: "新对话", createdAt: "", updatedAt: "" }]);
          setActiveSessionId(id);
        }
      }
    } catch {
      toast.error("删除会话失败");
    }
  };

  // 重命名会话（历史会话列表的行内编辑）
  const handleRenameSession = useCallback((sessionId: string, title: string) => {
    if (!user) return;
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, title } : s)));
    docStore.setChatSessionTitle({ userId: user.id }, sessionId, title).catch(() => {
      toast.error("重命名失败");
      refreshSessions();
    });
  }, [user, docStore, refreshSessions]);

  // ---- 发送与 SSE 事件消费 ----

  // 真正发起请求：首次发送与队列调度共用（不检查 loading，由 streamingRef 保证不并发）。
  // sessionId 为发起时快照：队列中的消息即使期间切换会话，仍发到入队时的会话。
  const sendMessage = async (content: string, sessionId: string, pendingAttachments: ChatAttachment[] = []) => {
    if (!content || !sessionId) return;
    // 归属防御：只允许为当前激活会话发请求（队列取件已按会话过滤，这里是兜底）
    if (activeSessionRef.current !== sessionId) return;
    streamingRef.current = true;

    // 请求 id 一次生成：既做幂等键，也是「撤销本次改动」的入参
    const requestId = crypto.randomUUID();

    // 新建 turn 并挂为当前流式回合
    const turn = createTurn(content);
    turn.requestId = requestId;
    turn.attachments = pendingAttachments.map((a) => ({ name: a.name, size: a.content.length }));
    setAttachments([]);
    currentTurnRef.current = turn;
    setTurns((prev) => [...prev, turn]);
    setLoading(true);
    stickToBottomRef.current = true;

    // 本轮已自动跳转过新建文档（只跳第一篇，避免连续创建时来回跳）
    let hasNavigated = false;

    const controller = new AbortController();
    abortRef.current = controller;
    /** 本请求是否仍归自己所有（切会话会把 abortRef 置空） */
    const owned = () => abortRef.current === controller;
    /** 当前会话是否仍是发起时的会话 */
    const stillActive = () => activeSessionRef.current === sessionId;

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: content,
          sessionId,
          requestId, // 服务端幂等，防重复提交
          documentId: params.documentId, // 当前文档上下文（服务端注入 system）
          attachments: turn.attachments, // 本轮附件（服务端拼进 prompt，不落库）
        }),
        signal: controller.signal, // 终止按钮 abort 此请求
      });

      if (!response.ok) {
        // 409 = 幂等拒绝（重复提交），与网络错误区分提示
        throw new Error(response.status === 409 ? "DuplicateRequest" : "RequestFailed");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let buffer = "";

      // SSE 事件分发：一律交给 reducer（顺序、去重、状态流转都在那里）
      const handleEvent = (event: SseEvent) => {
        const t = currentTurnRef.current;
        if (!t || !owned() || !stillActive()) return;
        const effects = applyTurnEvent(t, event);
        // 文本走 rAF 节流，其余事件立即提交
        if (event.type === "text") commitText();
        else commit();
        for (const effect of effects) {
          if (effect.kind === "toast") {
            if (effect.level === "warning") toast.warning(effect.message);
            else toast.error(effect.message);
          } else if (effect.kind === "note_modified") {
            triggerDocument(effect.noteId);
            triggerSidebar();
          } else if (effect.kind === "note_created") {
            // 建完直接跳过去让用户**查看**（这是用户明确的流程要求：
            // 新建 → 跳转查看 → 确认无误再点保存）。每轮只跳一次，避免多篇草稿来回跳。
            // 确认卡片仍在对话栏里（保存 / 丢弃），跳转后两者同屏可见。
            toast.success(`已生成草稿「${effect.title || "无标题"}」，确认无误后点「确认保存」`);
            if (!hasNavigated) {
              hasNavigated = true;
              const noteId = effect.noteId;
              window.setTimeout(() => navigate("/documents/" + noteId), NAVIGATE_DELAY_MS);
            }
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          if (!raw.startsWith("data: ")) continue;
          try {
            handleEvent(JSON.parse(raw.slice(6)) as SseEvent);
          } catch {
            // 非 JSON 事件行直接忽略
          }
        }

        // 会话已被切走：停止消费旧流，避免旧文本落进新会话
        if (!owned() || !stillActive()) break;
      }

      // 流自然结束但未收到 turn_end（旧服务端/异常）：补一个 done 态。
      // 这里**不再用 owned() 门控**：请求被新请求接管时 owned() 为假，
      // 若不收尾，那一轮会永远停在"正在思考"（用户看到的就是这个）。
      const t = currentTurnRef.current;
      if (t && t.status === "running") {
        finalizeTurn(t, "done");
        commit();
      }
      refreshSessions(); // 刷新会话列表（首个问题会自动命名会话）
    } catch (err) {
      const t = currentTurnRef.current;
      if (controller.signal.aborted) {
        // 用户主动停止（同一会话）：回合标记为 done，保留已生成的部分内容；
        // 切换会话导致的中止不处理，避免旧流污染新会话
        if (t && stillActive()) {
          finalizeTurn(t, "done");
          commit();
          toast.info("已停止生成");
        }
      } else if (t) {
        // 原实现只弹 toast，回合会永远停在"正在思考"（status 仍是 running）
        finalizeTurn(
          t,
          "error",
          err instanceof Error && err.message === "DuplicateRequest"
            ? "请求已提交，请勿重复发送"
            : "AI 请求失败，请稍后再试",
        );
        commit();
        if (stillActive()) toast.error(t.errorMessage ?? "AI 请求失败，请稍后再试");
      }
    } finally {
      // 归属校验：请求已被会话切换接管（abortRef 被置 null）时不清理状态、不调度队列
      if (owned()) {
        streamingRef.current = false;
        setLoading(false);
        abortRef.current = null;
      }
      if (!streamingRef.current) drainQueue();
    }
  };
  sendMessageRef.current = sendMessage;

  // 附件：选文件 → 读文本 → 校验（超限/非文本逐条提示）→ 进待发送清单
  const handlePickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const read = await Promise.all(
      list.map((file) => readAttachmentFile(file).catch(() => null)),
    );
    const valid = read.filter((item): item is { name: string; content: string } => item !== null);
    const { accepted, rejected } = validateAttachments(valid, attachments.length);
    if (accepted.length > 0) setAttachments((prev) => [...prev, ...accepted]);
    for (const item of rejected) toast.warning(`「${item.name}」：${item.reason}`);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // 输入框发送入口：流式进行中则入队排队（记录会话快照），结束后自动发送
  const handleSend = (content: string) => {
    if (!content || !activeSessionId) return;
    recallIndexRef.current = -1;
    queueSuppressedRef.current = false; // 用户主动发消息 → 队列恢复自动发送
    setQueueSuppressed(false);

    if (streamingRef.current) {
      const item = createQueuedMessage(content, activeSessionId);
      queueRef.current = enqueue(queueRef.current, item);
      setQueueItems(queueRef.current);
      return;
    }

    void sendMessageRef.current(content, activeSessionId, attachments);
  };

  // 输入框为空时按 ↑：召回本会话最近发过的消息（最新的在前，可连续往回走）
  const recallIndexRef = useRef(-1);
  const handleRecall = useCallback(() => {
    const history = recentUserMessages(turnsRef.current);
    const next = stepRecallIndex(recallIndexRef.current, history.length, -1);
    recallIndexRef.current = next;
    if (next >= 0 && history[next]) mentionRef.current?.setText(history[next]);
  }, []);

  // 终止当前流式生成（服务端通过 abortSignal 同步中断；不再自动续发排队消息）
  const handleStop = useCallback(() => {
    queueSuppressedRef.current = true;
    setQueueSuppressed(true);
    abortRef.current?.abort();
  }, []);

  // 停止并立刻开一个新对话（"这次不聊了 / 换个话题"一步到位）。
  // 用 ref 转发到"最新一次渲染的函数"，既保证 TurnView 的 memo 不被新函数引用击穿，
  // 又能读到最新的 sessions / activeSessionId（否则会拿到过期闭包）。
  const stopAndNewSessionRef = useRef<() => void>(() => {});
  stopAndNewSessionRef.current = () => {
    handleStop();
    const active = sessions.find((s) => s.id === activeSessionId);
    if (active?.title === "新对话") {
      // 已经是空的新对话：不重复创建，明确告诉用户（否则会以为按钮坏了）
      toast.info("当前已经是新对话，已停止生成");
      return;
    }
    void handleNewSession();
  };
  const handleStopAndNewSession = useCallback(() => stopAndNewSessionRef.current(), []);

  // 恢复队列自动发送（用户点「继续发送」）
  const resumeQueue = useCallback(() => {
    queueSuppressedRef.current = false;
    setQueueSuppressed(false);
    drainQueue();
  }, [drainQueue]);

  // 失败回合重试：把同一条用户输入作为新一轮发出
  const handleRetry = useCallback((turn: Turn) => {
    const sessionId = activeSessionRef.current;
    if (!sessionId) return;
    void sendMessageRef.current(turn.userContent, sessionId);
  }, []);

  // 撤销本轮 AI 改动：恢复改动前的文档状态（改了几篇就恢复几篇）
  const handleUndo = useCallback((turn: Turn) => {
    if (!turn.requestId) return;
    const requestId = turn.requestId;
    const promise = docStore.undoAiChanges(actor, requestId).then(({ restored }) => {
      if (restored.length === 0) {
        // 已经撤销过 / 文档已删除：只更新按钮态
        setTurns((prev) => prev.map((t) => (t.requestId === requestId ? { ...t, undone: true } : t)));
        return null;
      }
      setTurns((prev) => prev.map((t) => (t.requestId === requestId ? { ...t, undone: true } : t)));
      triggerSidebar();
      const current = params.documentId;
      if (current && restored.includes(current)) triggerDocument(current);
      return restored.length;
    });
    toast.promise(promise, {
      loading: "正在撤销本次改动…",
      success: (count) => (count ? `已撤销本次改动（${count} 篇文档）` : "本轮改动已无可撤销内容"),
      error: "撤销失败",
    });
  }, [docStore, actor, triggerSidebar, triggerDocument, params.documentId]);

  // 查看改动：懒加载本轮每篇文档的改动前后对照
  const handlePreviewChanges = useCallback(
    (turn: Turn) => (turn.requestId ? docStore.previewAiChanges(actor, turn.requestId) : Promise.resolve([])),
    [docStore, actor],
  );

  // 编辑重发：把该轮用户输入回填到输入框（胶囊还原为胶囊），用户改完自己发
  const handleEditUser = useCallback((turn: Turn) => {
    mentionRef.current?.setText(turn.userContent);
  }, []);

  // 插入本文档：把该轮回答（Markdown）追加到当前打开文档的末尾
  const handleInsertToDocument = useCallback((turn: Turn) => {
    const documentId = params.documentId;
    if (!documentId || !turn.text.trim()) return;
    const promise = docStore.appendMarkdown(actor, documentId, turn.text).then(() => {
      triggerDocument(documentId);
    });
    toast.promise(promise, {
      loading: "正在插入到文档…",
      success: "已插入到文档末尾",
      error: "插入失败",
    });
  }, [docStore, actor, params.documentId, triggerDocument]);

  // 另存为笔记：用回答的 Markdown 建一篇新笔记（编辑器会惰性转成块）
  const handleSaveAsNote = useCallback((turn: Turn) => {
    const text = turn.text.trim();
    if (!text) return;
    // 标题取第一行非空文本，去掉 Markdown 记号
    const firstLine = text.split("\n").find((line) => line.trim()) ?? "AI 回答";
    const title = firstLine.replace(/^#+\s*/, "").replace(/[*_`>\-\s]+/g, " ").trim().slice(0, 40) || "AI 回答";
    const promise = docStore.create(actor, title).then(async (id) => {
      await docStore.update(actor, id, { content: text });
      triggerSidebar();
      return id;
    });
    toast.promise(promise, {
      loading: "正在另存为笔记…",
      success: (id) => ({ message: `已创建「${title}」`, action: { label: "打开", onClick: () => navigate("/documents/" + id) } }),
      error: "另存失败",
    });
  }, [docStore, actor, triggerSidebar, navigate]);

  // 点击胶囊/引用跳转前先确认文档存在，已删除的文档提示而不跳转（避免 not found 页）
  const openDocument = useCallback((id: string) => {
    docStore.getById(actor, id)
      .then(() => navigate("/documents/" + id))
      .catch(() => toast.error("文档不存在或已删除"));
  }, [docStore, actor, navigate]);

  // ---- 确认卡 / 提问卡的回填（稳定回调：TurnView 是 memo 的）----

  const markResolved = useCallback((kind: "delete_confirm" | "move_confirm", noteId: string) => {
    setTurns((prev) => markNoteResolved(prev, kind, noteId));
  }, []);

  const handleConfirmDelete = useCallback((noteId: string, title: string) => {
    const promise = docStore.remove(actor, noteId).then(() => {
      triggerSidebar();
      // 如果当前正在查看被删除的文档，跳转到文档列表
      if (params.documentId === noteId) navigate("/documents");
      markResolved("delete_confirm", noteId);
    });

    toast.promise(promise, {
      loading: "正在删除「" + title + "」...",
      success: "「" + title + "」已永久删除",
      error: "删除失败",
    });
    // 失败时卡片保持待确认态（用户可重试）；同时保证调用方拿到的 promise 不产生未处理拒绝
    return promise.then(() => undefined, () => undefined);
  }, [docStore, actor, triggerSidebar, params.documentId, navigate, markResolved]);

  const handleCancelDelete = useCallback((noteId: string) => {
    markResolved("delete_confirm", noteId);
    toast.info("已取消删除");
  }, [markResolved]);

  /** AI 草稿：确认保存（isDraft=false，进入正式笔记列表） */
  const handleConfirmDraft = useCallback((noteId: string, title: string) => {
    const promise = docStore.update(actor, noteId, { isDraft: false }).then(() => {
      triggerSidebar();
      setTurns((prev) => markDraftResolved(prev, noteId, "saved"));
    });
    toast.promise(promise, {
      loading: `正在保存「${title}」…`,
      success: `「${title}」已保存`,
      error: "保存失败",
    });
    return promise.then(() => undefined, () => undefined);
  }, [docStore, actor, triggerSidebar]);

  /** AI 草稿：丢弃（删除；正在查看它时回到文档列表） */
  const handleDiscardDraft = useCallback((noteId: string, title: string) => {
    const promise = docStore.remove(actor, noteId).then(() => {
      triggerSidebar();
      if (params.documentId === noteId) navigate("/documents");
      setTurns((prev) => markDraftResolved(prev, noteId, "discarded"));
    });
    toast.promise(promise, {
      loading: `正在丢弃「${title}」…`,
      success: `已丢弃草稿「${title}」`,
      error: "丢弃失败",
    });
    return promise.then(() => undefined, () => undefined);
  }, [docStore, actor, triggerSidebar, params.documentId, navigate]);

  const handleConfirmMove = useCallback((noteId: string, title: string, parentDocument: string | null) => {
    const promise = docStore.move(actor, noteId, parentDocument).then(() => {
      triggerSidebar();
      triggerDocument(noteId);
      markResolved("move_confirm", noteId);
    });
    toast.promise(promise, {
      loading: "正在移动「" + title + "」...",
      success: "「" + title + "」已移动",
      error: "移动失败",
    });
    return promise.then(() => undefined, () => undefined);
  }, [docStore, actor, triggerSidebar, triggerDocument, markResolved]);

  const handleCancelMove = useCallback((noteId: string) => {
    markResolved("move_confirm", noteId);
    toast.info("已取消移动");
  }, [markResolved]);

  // 问题回答回传（对齐 SiYuan question 工具）：把用户选择拼接为新的用户消息发送，
  // AI 在下一轮看到回答后继续执行；卡片同时回填为"已回答"（不可重复提交）
  const handleQuestionAnswer = useCallback(
    (turnId: string, index: number, question: Question, answers: string[], customText?: string) => {
      if (question.answered) return;
      const parts = answers.filter(Boolean);
      if (customText?.trim()) parts.push(customText.trim());
      const answerText = parts.length > 0 ? parts.join("；") : "（未选择，跳过）";
      setTurns((prev) => markQuestionAnswered(prev, turnId, index, answerText));
      handleSend(`【回答】${question.question}\n${answerText}`);
    },
    // handleSend 每次渲染都会重建，但只捕获 ref/state，语义稳定；这里刻意不依赖它
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // 移除/清空队列
  const removeFromQueue = (index: number) => {
    queueRef.current = removeQueueAt(queueRef.current, index);
    setQueueItems(queueRef.current);
  };

  const clearQueue = () => {
    queueRef.current = [];
    setQueueItems([]);
  };

  // ---- 渲染：DSH DetailsPanel 头部 + turn 时间线 + 悬浮输入卡 ----

  return (
    <aside className="flex h-full min-w-0 flex-col overflow-hidden" aria-label="AI 文档助手">
      {/* 头部：pad 14/12/12/12，标题 14/20 wt500，28px 圆形操作 */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b-[0.5px] border-shell-border px-2.5 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-5 w-5 flex-none items-center justify-center rounded-[6px] bg-ai text-ai-foreground">
            <Sparkles className="h-3 w-3" />
          </span>
          <span className="truncate text-[13px] font-semibold leading-5 tracking-[-0.01em] text-shell-label-primary">
            {sessions.find((s) => s.id === activeSessionId)?.title ?? "新对话"}
          </span>
        </div>
        <div className="flex flex-none items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="历史会话"
                title="历史会话"
                className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-[6px] text-shell-label-secondary transition-colors hover:bg-shell-row-hover hover:text-shell-label-primary"
              >
                <History className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 p-0">
              <SessionMenu
                sessions={filterSessionsByScope(sessions, sessionScope, params.documentId)}
                scope={sessionScope}
                canFilterByDocument={!!params.documentId}
                onScopeChange={setSessionScope}
                activeSessionId={activeSessionId}
                onSelect={(id) => setActiveSessionId(id)}
                onRename={handleRenameSession}
                onDelete={(id) => void handleDeleteSession(id)}
              />
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            aria-label="新增会话"
            title="新增会话"
            onClick={handleNewSession}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-[6px] text-shell-label-secondary transition-colors hover:bg-shell-row-hover hover:text-shell-label-primary"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="关闭"
            title="关闭"
            onClick={closeDetails}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-[6px] text-shell-label-secondary transition-colors hover:bg-shell-row-hover hover:text-shell-label-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* turn 时间线：唯一滚动区 + 底部渐变 fade */}
      <div
        ref={messagesRef}
        onScroll={onMessagesScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-label="与文档助手的对话"
        className="relative min-h-0 flex-1 overflow-y-auto"
      >
        <div className="flex min-h-full flex-col gap-4 px-3.5 py-4">
          {hasMoreHistory && turns.length > 0 && (
            <button
              type="button"
              onClick={() => setHistoryLimit((n) => n + HISTORY_PAGE)}
              className="mx-auto cursor-pointer rounded-full border-[0.5px] border-shell-border-l2 px-3 py-1 text-xs text-shell-label-secondary transition-colors hover:bg-shell-row-hover hover:text-shell-label-primary"
            >
              加载更早的消息
            </button>
          )}
          {turns.length === 0 && !loading && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 pb-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-ai text-ai-foreground shadow-[var(--shadow-sm)]">
                <Bot className="h-6 w-6" />
              </div>
              <div className="space-y-1.5">
                <p className="text-[22px] font-semibold leading-7 tracking-[-0.02em] text-shell-label-primary">你好，我是你的文档助手</p>
                <p className="text-[13px] leading-5 text-shell-label-tertiary">
                  我可以帮你搜索、撰写、改写和整理笔记。
                  <br />
                  新建的笔记先以草稿出现在这里，你确认保存或丢弃；
                  「删除」这类破坏性操作也会先问你。
                </p>
              </div>
            </div>
          )}

          {turns.map((turn) => (
            <TurnView
              key={turn.id}
              turn={turn}
              onOpenDocument={openDocument}
              onConfirmDelete={handleConfirmDelete}
              onCancelDelete={handleCancelDelete}
              onConfirmMove={handleConfirmMove}
              onCancelMove={handleCancelMove}
              onConfirmDraft={handleConfirmDraft}
              onDiscardDraft={handleDiscardDraft}
              onAnswerQuestion={handleQuestionAnswer}
              onRetry={handleRetry}
              onStop={handleStop}
              onStopAndNewSession={handleStopAndNewSession}
              onUndo={handleUndo}
              onPreviewChanges={handlePreviewChanges}
              onEditUser={handleEditUser}
              onInsertToDocument={handleInsertToDocument}
              onSaveAsNote={handleSaveAsNote}
              canInsertToDocument={!!params.documentId}
            />
          ))}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-9 bg-gradient-to-t from-shell-bg-base to-transparent" />
        {showJumpToBottom && (
          <button
            type="button"
            onClick={() => scrollToBottom(true)}
            className="material-popover absolute bottom-3 left-1/2 z-10 flex h-7 -translate-x-1/2 cursor-pointer items-center gap-1 rounded-full border-[0.5px] border-shell-border-l2 px-3 text-xs font-medium text-shell-label-secondary shadow-[var(--shadow-md)] transition-colors hover:text-shell-label-primary"
          >
            回到底部
          </button>
        )}
      </div>

      {/* 悬浮输入卡 */}
      <div className="shrink-0 px-3 pb-3 pt-1">
        {queueItems.length > 0 && (
          <div className="mb-3 rounded-xl border border-shell-border-l2 bg-shell-row-hover p-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-shell-label-secondary">
                待发送队列（{queueItems.length}）
                {queueSuppressed && <span className="ml-1 text-shell-label-tertiary">· 已暂停自动发送</span>}
              </span>
              {queueSuppressed && (
                <button
                  type="button"
                  onClick={resumeQueue}
                  className="cursor-pointer text-xs text-shell-accent hover:underline"
                >
                  继续发送
                </button>
              )}
              <button
                type="button"
                onClick={clearQueue}
                className="cursor-pointer text-xs text-shell-label-tertiary transition-colors hover:text-shell-label-primary"
              >
                清空
              </button>
            </div>
            <div className="max-h-28 space-y-1 overflow-y-auto">
              {queueItems.map((item, index) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-md bg-shell-bg-base/70 px-2 py-1"
                >
                  <span className="min-w-0 flex-1 truncate text-xs text-shell-label-primary/80">{item.content}</span>
                  {item.sessionId !== activeSessionId && (
                    <span className="shrink-0 rounded bg-shell-row-active px-1 text-[10px] text-shell-label-tertiary">
                      其他会话
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeFromQueue(index)}
                    title="移除该条"
                    aria-label="移除这条待发送消息"
                    className="shrink-0 cursor-pointer rounded-sm p-0.5 text-shell-label-tertiary transition-colors hover:bg-shell-row-hover hover:text-shell-label-primary"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((item, index) => (
              <span
                key={item.name + index}
                className="inline-flex max-w-[220px] items-center gap-1.5 rounded-[7px] border-[0.5px] border-shell-border-l2 bg-shell-row-hover px-2 py-1 text-xs text-shell-label-secondary"
              >
                <FileText className="h-3 w-3 flex-none" />
                <span className="truncate">{item.name}</span>
                <span className="flex-none text-[10px] text-shell-label-caption">
                  {item.content.length.toLocaleString()} 字
                </span>
                <button
                  type="button"
                  title="移除附件"
                  aria-label={`移除附件 ${item.name}`}
                  onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}
                  className="flex-none cursor-pointer rounded-sm p-0.5 hover:text-shell-label-primary"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        {/* 输入卡：Apple 的填充式输入区（14px 圆角 + 发丝描边 + 柔和阴影） */}
        <div className="rounded-[14px] border-[0.5px] border-shell-border-l2 bg-card shadow-[var(--shadow-sm)] transition-shadow focus-within:shadow-[var(--shadow-md)]">
          <MentionInput
            ref={mentionRef}
            onSubmit={handleSend}
            onEmptyChange={setInputEmpty}
            onEscape={loading ? handleStop : undefined}
            onRecall={handleRecall}
            placeholder={loading ? "正在生成，输入后自动排队发送..." : "输入你的问题，@ 可提及文档..."}
            className="px-1 pt-2.5"
          />
          <div className="flex items-center justify-between gap-3 px-2 pb-1.5 pt-0.5">
            <div className="flex min-w-0 items-center gap-2 text-[11px] leading-[16px] text-shell-label-tertiary">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ATTACHMENT_EXTENSIONS.join(",")}
                className="hidden"
                onChange={(e) => void handlePickFiles(e.target.files)}
              />
              <button
                type="button"
                title="附加文本文件作为上下文"
                aria-label="附加文本文件"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-5 w-5 flex-none cursor-pointer items-center justify-center rounded-[5px] transition-colors hover:bg-shell-row-hover hover:text-shell-label-secondary"
              >
                <Paperclip className="h-3 w-3" />
              </button>
              {loading ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span className="truncate">正在生成…（Esc 停止）</span>
                </>
              ) : (
                <span className="truncate">@ 可提及文档 · Enter 发送 / Shift+Enter 换行</span>
              )}
            </div>
            <button
              type="button"
              title={loading ? "停止生成" : "发送"}
              aria-label={loading ? "停止生成" : "发送"}
              onClick={loading ? handleStop : () => mentionRef.current?.submit()}
              disabled={!loading && inputEmpty}
              className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground transition-all duration-150 hover:bg-[color-mix(in_srgb,var(--primary)_88%,black)] active:scale-95 disabled:cursor-default disabled:opacity-35"
            >
              {loading ? <Square className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default AiPanel;
