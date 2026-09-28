"use client";

// AI 面板（details 列）——DSH 风格 turn 时间线：
// 一轮用户输入 = 一个 Turn（用户气泡 + 有序 part 序列 + 引用 + footer），
// SSE 事件按到达顺序归组渲染（状态流转见 ./ai/turn-reducer.ts，纯逻辑已抽出去可测）。
//
// 本组件只负责 I/O 与编排：请求生命周期、队列调度、滚动、确认/提问的回填。
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Bot, Check, History, Loader2, MessageSquare, Plus, Send, Sparkles, Square, Trash2, X } from "@/components/icons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useLayout } from "@/hooks/use-layout";
import { useUser } from "@/hooks/use-user";
import { useRefresh } from "@/hooks/use-refresh";
import type { ChatSession } from "@/lib/seams/doc-store";
import { useActor, useDocStore } from "@/src/kernel/react";
import MentionInput, { type MentionInputHandle } from "./mention-input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createTurn, type Question, type SseEvent, type Turn } from "./ai/types";
import {
  applyTurnEvent,
  createQueuedMessage,
  enqueue,
  finalizeTurn,
  markNoteResolved,
  markQuestionAnswered,
  pendingDeleteIds,
  rebuildTurns,
  removeQueueAt,
  takeNextForSession,
  type QueuedMessage,
} from "./ai/turn-reducer";
import { TurnView } from "./ai/turn";

/** 粘底判定阈值：距底小于该值就算"跟到底部" */
const STICK_THRESHOLD_PX = 80;

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
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- turn 时间线 ----
  const [turns, setTurns] = useState<Turn[]>([]);
  // 当前流式回合（reducer 就地改该对象，commit 触发渲染）
  const currentTurnRef = useRef<Turn | null>(null);
  // 流式文本 rAF 节流
  const textRaf = useRef<number | null>(null);
  // 卸载守卫：rAF / fetch 回调可能在组件卸载后落地
  const mountedRef = useRef(true);

  // 流式请求控制：当前是否在生成、终止用 AbortController、待发送队列（含会话快照）
  const streamingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<QueuedMessage[]>([]);
  const [queueItems, setQueueItems] = useState<QueuedMessage[]>([]);
  const [inputEmpty, setInputEmpty] = useState(true);
  const [loading, setLoading] = useState(false);
  const mentionRef = useRef<MentionInputHandle>(null);
  // 当前激活会话 ref：abort 分支区分"用户手动停止"与"切换会话导致的中止"
  const activeSessionRef = useRef<string | null>(null);
  activeSessionRef.current = activeSessionId;

  const userId = user?.id;

  /** 立即提交（工具/副作用事件） */
  const commit = useCallback(() => {
    if (mountedRef.current) setTurns((prev) => [...prev]);
  }, []);

  /** 流式文本提交（每帧最多一次） */
  const commitText = useCallback(() => {
    if (textRaf.current !== null) return;
    textRaf.current = requestAnimationFrame(() => {
      textRaf.current = null;
      commit();
    });
  }, [commit]);

  // 卸载收尾：取消飞行中的 rAF 与确认计时器（原实现在已卸载组件上 setState 且计时器泄漏）
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (textRaf.current !== null) cancelAnimationFrame(textRaf.current);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, []);

  // ---- 发送（先声明 ref，供队列调度与稳定回调引用最新闭包）----
  const sendMessageRef = useRef<(content: string, sessionId: string) => Promise<void>>(async () => {});

  /** 队列调度：只取**当前激活会话**的待发消息（切会话绝不把旧会话的消息发出去） */
  const drainQueue = useCallback(() => {
    if (streamingRef.current) return;
    const { item, rest } = takeNextForSession(queueRef.current, activeSessionRef.current);
    if (!item) return;
    queueRef.current = rest;
    if (mountedRef.current) setQueueItems(rest);
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
          await docStore.createChatSession({ userId });
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
    currentTurnRef.current = null;
    setTurns([]);
    docStore.listChatHistory({ userId }, activeSessionId)
      .then(async (msgs) => {
        if (!alive) return;
        const rebuilt = rebuildTurns(msgs);
        setTurns(rebuilt);
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
        if (!alive || gone.length === 0) return;
        setTurns((prev) => gone.reduce((acc, noteId) => markNoteResolved(acc, "delete_confirm", noteId), prev));
      })
      .catch(() => {
        // 历史拉取失败不阻塞，保持空对话
      })
      .finally(() => {
        // 回到本会话时把属于它的排队消息接着发出去（另一端 drainQueue 只在发送结束时调度）
        if (alive) drainQueue();
      });
    return () => { alive = false; };
  }, [userId, activeSessionId, docStore, actor, drainQueue]);

  // ---- 滚动：粘底才跟随（原来无条件 scrollTo 底部，用户上翻读历史会被每帧打断）----
  const messagesRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
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
      .then((list) => { if (mountedRef.current) setSessions(list); })
      .catch(() => {});
  }, [user, docStore]);

  const handleNewSession = async () => {
    if (!user) return;
    // 当前激活的已是空的新对话（标题未被自动命名 = 从未发过消息），不重复创建
    const active = sessions.find((s) => s.id === activeSessionId);
    if (active?.title === "新对话") return;
    try {
      const id = await docStore.createChatSession({ userId: user.id });
      setSessions((prev) => [
        { id, title: "新对话", createdAt: "", updatedAt: "" },
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
    // 二次确认：第一次点击进入确认态，3 秒内再点才删除
    if (confirmingDeleteId !== sessionId) {
      setConfirmingDeleteId(sessionId);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmingDeleteId(null), 3000);
      return;
    }
    setConfirmingDeleteId(null);
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

  // ---- 发送与 SSE 事件消费 ----

  // 真正发起请求：首次发送与队列调度共用（不检查 loading，由 streamingRef 保证不并发）。
  // sessionId 为发起时快照：队列中的消息即使期间切换会话，仍发到入队时的会话。
  const sendMessage = async (content: string, sessionId: string) => {
    if (!content || !sessionId) return;
    // 归属防御：只允许为当前激活会话发请求（队列取件已按会话过滤，这里是兜底）
    if (activeSessionRef.current !== sessionId) return;
    streamingRef.current = true;

    // 请求 id 一次生成：既做幂等键，也是「撤销本次改动」的入参
    const requestId = crypto.randomUUID();

    // 新建 turn 并挂为当前流式回合
    const turn = createTurn(content);
    turn.requestId = requestId;
    currentTurnRef.current = turn;
    setTurns((prev) => [...prev, turn]);
    setLoading(true);
    stickToBottomRef.current = true;

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
            // 不再 800ms 后强制跳转（会打断正在阅读/输入的用户）：给一个可点的 toast，
            // 卡片上的「打开」按钮也一直在
            toast.success(`已创建「${effect.title || "无标题"}」`, {
              action: { label: "打开", onClick: () => navigate("/documents/" + effect.noteId) },
            });
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

      // 流自然结束但未收到 turn_end（旧服务端/异常）：补一个 done 态
      const t = currentTurnRef.current;
      if (t && owned() && t.status === "running") {
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
      } else if (t && owned() && stillActive()) {
        // 原实现只弹 toast，回合会永远停在"正在思考"（status 仍是 running）
        finalizeTurn(
          t,
          "error",
          err instanceof Error && err.message === "DuplicateRequest"
            ? "请求已提交，请勿重复发送"
            : "AI 请求失败，请稍后再试",
        );
        commit();
      }
    } finally {
      // 归属校验：请求已被会话切换接管（abortRef 被置 null）时不清理状态、不调度队列
      if (owned()) {
        streamingRef.current = false;
        if (mountedRef.current) setLoading(false);
        abortRef.current = null;
      }
      if (!streamingRef.current) drainQueue();
    }
  };
  sendMessageRef.current = sendMessage;

  // 输入框发送入口：流式进行中则入队排队（记录会话快照），结束后自动发送
  const handleSend = (content: string) => {
    if (!content || !activeSessionId) return;

    if (streamingRef.current) {
      const item = createQueuedMessage(content, activeSessionId);
      queueRef.current = enqueue(queueRef.current, item);
      setQueueItems(queueRef.current);
      return;
    }

    void sendMessageRef.current(content, activeSessionId);
  };

  // 终止当前流式生成（服务端通过 abortSignal 同步中断）
  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

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
            <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
              {sessions.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-shell-label-tertiary">暂无历史会话</div>
              )}
              {sessions.map((s) => (
                <DropdownMenuItem
                  key={s.id}
                  onClick={() => setActiveSessionId(s.id)}
                  className="flex cursor-pointer items-center gap-2"
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 text-shell-label-tertiary" />
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  {s.id === activeSessionId && <Check className="h-3.5 w-3.5 shrink-0 text-shell-accent" />}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDeleteSession(s.id);
                    }}
                    className={cn(
                      "shrink-0 cursor-pointer rounded p-0.5 hover:bg-destructive/10 hover:text-destructive",
                      confirmingDeleteId === s.id
                        ? "bg-destructive/10 text-destructive"
                        : "text-shell-label-tertiary"
                    )}
                    title={confirmingDeleteId === s.id ? "再次点击确认删除" : "删除会话"}
                  >
                    {confirmingDeleteId === s.id ? (
                      <span className="px-0.5 text-[10px] font-medium">确认?</span>
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </DropdownMenuItem>
              ))}
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
        className="relative min-h-0 flex-1 overflow-y-auto"
      >
        <div className="flex min-h-full flex-col gap-4 px-3.5 py-4">
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
                  改动会写进文档，「删除」这类破坏性操作会先问你确认。
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
              onAnswerQuestion={handleQuestionAnswer}
              onRetry={handleRetry}
              onUndo={handleUndo}
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
              </span>
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
                    className="shrink-0 cursor-pointer rounded-sm p-0.5 text-shell-label-tertiary transition-colors hover:bg-shell-row-hover hover:text-shell-label-primary"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* 输入卡：Apple 的填充式输入区（14px 圆角 + 发丝描边 + 柔和阴影） */}
        <div className="rounded-[14px] border-[0.5px] border-shell-border-l2 bg-card shadow-[var(--shadow-sm)] transition-shadow focus-within:shadow-[var(--shadow-md)]">
          <MentionInput
            ref={mentionRef}
            onSubmit={handleSend}
            onEmptyChange={setInputEmpty}
            onEscape={loading ? handleStop : undefined}
            placeholder={loading ? "正在生成，输入后自动排队发送..." : "输入你的问题，@ 可提及文档..."}
            className="px-1 pt-2.5"
          />
          <div className="flex items-center justify-between gap-3 px-2 pb-1.5 pt-0.5">
            <div className="flex min-w-0 items-center gap-2 text-[11px] leading-[16px] text-shell-label-tertiary">
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
