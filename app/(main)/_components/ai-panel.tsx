"use client";

// AI 面板（details 列）——DSH 风格 turn 时间线：
// 一轮用户输入 = 一个 Turn（用户气泡 + 工具卡片序列 + 文档副作用卡片 + 叙述 + 引用 + footer），
// SSE 事件按 turn 归组渲染，工具生命周期以卡片呈现（running → done/error）。
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Bot, Check, History, Loader2, MessageSquare, Plus, Send, Sparkles, Square, Trash2, X } from "@/components/icons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useLayout } from "@/hooks/use-layout";
import { useUser } from "@/hooks/use-user";
import { useRefresh } from "@/hooks/use-refresh";
import {
  createChatSession,
  deleteChatSession,
  getById,
  getChatHistory,
  getChatSessions,
  remove,
  type ChatSession,
} from "@/lib/db";
import MentionInput, { type MentionInputHandle } from "./mention-input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { createTurn, type SseEvent, type Turn } from "./ai/types";
import { TurnView } from "./ai/turn";

const AiPanel = () => {
  // details 列由布局 store 控制：0 宽 = 关闭（保持挂载），>0 = 打开
  const detailsOpen = useLayout((s) => s.details > 0);
  const closeDetails = useLayout((s) => s.closeDetails);
  const { user } = useUser();
  const triggerSidebar = useRefresh((s) => s.triggerSidebar);
  const triggerDocument = useRefresh((s) => s.triggerDocument);
  const params = useParams();
  const router = useRouter();

  // ---- 会话状态 ----
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- turn 时间线 ----
  const [turns, setTurns] = useState<Turn[]>([]);
  // 当前流式回合（SSE 事件直接改该对象，commit 触发渲染）
  const currentTurnRef = useRef<Turn | null>(null);
  // 流式文本 rAF 节流
  const textRaf = useRef<number | null>(null);
  const commitText = () => {
    if (textRaf.current !== null) return;
    textRaf.current = requestAnimationFrame(() => {
      textRaf.current = null;
      setTurns((prev) => [...prev]);
    });
  };
  // 立即提交（工具/副作用事件）
  const commit = () => setTurns((prev) => [...prev]);

  // 流式请求控制：当前是否在生成、终止用 AbortController、待发送队列（含会话快照）
  const streamingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<Array<{ content: string; sessionId: string }>>([]);
  const [queueItems, setQueueItems] = useState<Array<{ content: string; sessionId: string }>>([]);
  const [inputEmpty, setInputEmpty] = useState(true);
  const [loading, setLoading] = useState(false);
  const mentionRef = useRef<MentionInputHandle>(null);
  // 当前激活会话 ref：abort 分支区分"用户手动停止"与"切换会话导致的中止"
  const activeSessionRef = useRef<string | null>(null);
  activeSessionRef.current = activeSessionId;

  const userId = user?.id;

  // 初始化：加载会话列表；无会话时自动创建一个（全局对话，不绑定文档）
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    getChatSessions(userId)
      .then(async (list) => {
        if (!alive) return;
        let sessionsList = list;
        if (sessionsList.length === 0) {
          await createChatSession(userId);
          sessionsList = await getChatSessions(userId);
        }
        if (!alive) return;
        setSessions(sessionsList);
        setActiveSessionId(sessionsList[0].id);
      })
      .catch(() => {
        // 拉取失败不阻塞，保持空状态
      });
    return () => { alive = false; };
  }, [userId]);

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
    getChatHistory(userId, activeSessionId)
      .then((msgs) => {
        if (!alive) return;
        // 扁平消息 → 成对重组为 turn（user 开头，assistant 归入上一个 turn）
        const rebuilt: Turn[] = [];
        let current: Turn | null = null;
        for (const m of msgs) {
          if (m.role === "user") {
            current = createTurn(m.content);
            rebuilt.push(current);
          } else if (current) {
            current.text = m.content;
            current.status = "done";
            current.durationMs = 0;
          }
        }
        setTurns(rebuilt);
      })
      .catch(() => {
        // 历史拉取失败不阻塞，保持空对话
      });
    return () => { alive = false; };
  }, [userId, activeSessionId]);

  // 每次打开面板都滚到最新（关闭时 state 保留）
  const messagesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (detailsOpen) {
      messagesRef.current?.scrollTo(0, messagesRef.current.scrollHeight);
    }
  }, [detailsOpen, turns]);

  // ---- 会话操作 ----

  const refreshSessions = () => {
    if (!user) return;
    getChatSessions(user.id)
      .then(setSessions)
      .catch(() => {});
  };

  const handleNewSession = async () => {
    if (!user) return;
    // 当前激活的已是空的新对话（标题未被自动命名 = 从未发过消息），不重复创建
    const active = sessions.find((s) => s.id === activeSessionId);
    if (active?.title === "新对话") return;
    try {
      const id = await createChatSession(user.id);
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
      await deleteChatSession(user.id, sessionId);
      const next = sessions.filter((s) => s.id !== sessionId);
      setSessions(next);
      if (activeSessionId === sessionId) {
        // 删除的是当前会话：激活下一个，没有则新建
        if (next.length > 0) {
          setActiveSessionId(next[0].id);
        } else {
          const id = await createChatSession(user.id);
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
    streamingRef.current = true;

    // 新建 turn 并挂为当前流式回合
    const turn = createTurn(content);
    currentTurnRef.current = turn;
    setTurns((prev) => [...prev, turn]);
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    let hasNavigated = false; // note_created 自动跳转只执行一次

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: content,
          sessionId,
          requestId: crypto.randomUUID(), // 服务端幂等，防重复提交
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

      // SSE 事件分发：事件按 turn 归组（工具卡片 / 副作用卡片 / 引用 / footer）
      const handleEvent = (event: SseEvent) => {
        const t = currentTurnRef.current;
        if (!t) return;
        switch (event.type) {
          case "turn_start":
            break; // turn 已在发送时创建
          case "text":
            t.text += event.text;
            commitText();
            break;
          case "tool_start":
            t.tools.push({
              seq: event.seq,
              tool: event.tool,
              label: event.label,
              argsText: event.argsText,
              state: "running",
              summary: "",
            });
            commit();
            break;
          case "tool_end": {
            const card = t.tools.find((c) => c.seq === event.seq);
            if (card) {
              card.state = event.ok ? "done" : "error";
              card.summary = event.summary;
            }
            commit();
            break;
          }
          case "note_created":
            t.notes.push({ kind: "created", noteId: event.noteId, title: event.title });
            commit();
            if (!hasNavigated) {
              hasNavigated = true;
              setTimeout(() => {
                router.push("/documents/" + event.noteId);
              }, 800);
            }
            break;
          case "note_modified":
            t.notes.push({ kind: "modified", noteId: event.noteId, title: event.title });
            commit();
            triggerDocument(event.noteId);
            triggerSidebar();
            break;
          case "confirm_delete":
            if (!t.notes.some((n) => n.kind === "delete_confirm" && !n.resolved)) {
              t.notes.push({ kind: "delete_confirm", noteId: event.noteId, title: event.title, resolved: false });
            }
            commit();
            break;
          case "reference":
            if (!t.references.some((r) => r.noteId === event.noteId)) {
              t.references.push({ noteId: event.noteId, title: event.title });
              commit();
            }
            break;
          case "turn_end":
            t.status = "done";
            t.durationMs = event.durationMs;
            t.tokens = event.tokens;
            commit();
            break;
          case "error":
            t.status = "error";
            commit();
            toast.error("AI 生成出错：" + event.message);
            break;
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
            handleEvent(JSON.parse(raw.slice(6)));
          } catch {
            // 非 JSON 事件行直接忽略
          }
        }
      }

      // 流自然结束但未收到 turn_end（旧服务端/异常）：补一个 done 态
      const t = currentTurnRef.current;
      if (t && t.status === "running") {
        t.status = "done";
        t.durationMs = Date.now() - t.createdAt;
        commit();
      }
      refreshSessions(); // 刷新会话列表（首个问题会自动命名会话）
    } catch (err) {
      if (controller.signal.aborted) {
        // 用户主动停止（同一会话）：回合标记为 done，保留已生成的部分内容；
        // 切换会话导致的中止（activeSessionId 已变）不处理，避免旧流污染新会话
        const t = currentTurnRef.current;
        if (t && activeSessionRef.current === sessionId) {
          t.status = "done";
          t.durationMs = Date.now() - t.createdAt;
          commit();
          toast.info("已停止生成");
        }
      } else {
        toast.error(
          err instanceof Error && err.message === "DuplicateRequest"
            ? "请求已提交，请勿重复发送"
            : "AI 请求失败，请稍后再试",
        );
      }
    } finally {
      // 归属校验：请求已被会话切换接管（abortRef 被置 null）时不调度队列/清理状态
      if (abortRef.current !== controller) return;
      streamingRef.current = false;
      setLoading(false);
      abortRef.current = null;
      // 队列调度：当前请求结束（正常/终止/失败）后自动发送下一条（含会话快照）
      const next = queueRef.current.shift();
      setQueueItems([...queueRef.current]);
      if (next) {
        setTimeout(() => sendMessage(next.content, next.sessionId), 60);
      }
    }
  };

  // 输入框发送入口：流式进行中则入队排队（记录会话快照），结束后自动发送
  const handleSend = (content: string) => {
    if (!content || !activeSessionId) return;

    if (streamingRef.current) {
      queueRef.current = [...queueRef.current, { content, sessionId: activeSessionId }];
      setQueueItems([...queueRef.current]);
      return;
    }

    void sendMessage(content, activeSessionId);
  };

  // 终止当前流式生成（服务端通过 abortSignal 同步中断）
  const handleStop = () => {
    abortRef.current?.abort();
  };

  // 点击胶囊/引用跳转前先确认文档存在，已删除的文档提示而不跳转（避免 not found 页）
  const openDocument = (id: string) => {
    getById(id)
      .then(() => router.push("/documents/" + id))
      .catch(() => toast.error("文档不存在或已删除"));
  };

  // 删除确认：确认后真正删除并标记该卡片已解决
  const markDeleteResolved = (noteId: string) => {
    setTurns((prev) =>
      prev.map((t) => ({
        ...t,
        notes: t.notes.map((n) =>
          n.kind === "delete_confirm" && n.noteId === noteId ? { ...n, resolved: true } : n
        ),
      })),
    );
  };

  const handleConfirmDelete = (noteId: string, title: string) => {
    const promise = remove(noteId).then(() => {
      triggerSidebar();
      // 如果当前正在查看被删除的文档，跳转到文档列表
      if (params.documentId === noteId) {
        router.push("/documents");
      }
      markDeleteResolved(noteId);
    });

    toast.promise(promise, {
      loading: "正在删除「" + title + "」...",
      success: "「" + title + "」已永久删除",
      error: "删除失败",
    });
  };

  const handleCancelDelete = (noteId: string) => {
    markDeleteResolved(noteId);
    toast.info("已取消删除");
  };

  // 移除/清空队列
  const removeFromQueue = (index: number) => {
    queueRef.current = queueRef.current.filter((_, i) => i !== index);
    setQueueItems([...queueRef.current]);
  };

  const clearQueue = () => {
    queueRef.current = [];
    setQueueItems([]);
  };
  // ---- 渲染：DSH DetailsPanel 头部 + turn 时间线 + 悬浮输入卡 ----

  return (
    <aside className="flex h-full min-w-0 flex-col overflow-hidden border-l border-shell-border bg-shell-bg-base">
      {/* 头部：pad 14/12/12/12，标题 14/20 wt500，28px 圆形操作 */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-shell-border-l2 px-3 pb-3 pt-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-ai text-ai-foreground">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <span className="truncate text-sm font-medium leading-5 text-shell-label-primary">
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
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-shell-label-secondary hover:bg-shell-row-hover"
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
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-shell-label-secondary hover:bg-shell-row-hover"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="关闭"
            title="关闭"
            onClick={closeDetails}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-shell-label-secondary hover:bg-shell-row-hover"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* turn 时间线：唯一滚动区 + 底部渐变 fade */}
      <div ref={messagesRef} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col gap-5 px-4 py-5">
          {turns.length === 0 && !loading && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 pb-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ai text-ai-foreground shadow-md">
                <Bot className="h-7 w-7" />
              </div>
              <div className="space-y-1.5">
                <p className="text-[26px] font-medium leading-8 text-shell-label-primary">你好，我是你的文档助手</p>
                <p className="text-[13px] leading-5 text-shell-label-tertiary">
                  帮你撰写、整理和管理笔记。
                  <br />
                  写新笔记时我会直接创建草稿，你确认或丢弃即可。
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
            />
          ))}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-9 bg-gradient-to-t from-shell-bg-base to-transparent" />
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
                  key={index + "-" + item.content}
                  className="flex items-center gap-2 rounded-md bg-shell-bg-base/70 px-2 py-1"
                >
                  <span className="min-w-0 flex-1 truncate text-xs text-shell-label-primary/80">{item.content}</span>
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
        {/* DSH 悬浮输入卡：22px 圆角、l2 描边、input-major 填充、lv2 阴影 */}
        <div className="rounded-[22px] border border-shell-border-l2 bg-card shadow-sm">
          <MentionInput
            ref={mentionRef}
            onSubmit={handleSend}
            onEmptyChange={setInputEmpty}
            placeholder={loading ? "正在生成，输入后自动排队发送..." : "输入你的问题，@ 可提及文档..."}
            className="px-1 pt-2.5"
          />
          <div className="flex items-center justify-between gap-3 px-2 pb-1.5 pt-1">
            <div className="flex min-w-0 items-center gap-2 text-[11px] leading-[16px] text-shell-label-tertiary">
              {loading ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span className="truncate">正在生成…</span>
                </>
              ) : (
                <span className="truncate">@ 可提及文档</span>
              )}
            </div>
            <button
              type="button"
              title={loading ? "停止生成" : "发送"}
              onClick={loading ? handleStop : () => mentionRef.current?.submit()}
              disabled={!loading && inputEmpty}
              className="flex h-[34px] w-[34px] flex-none cursor-pointer items-center justify-center rounded-full bg-ai text-ai-foreground transition-colors hover:bg-ai/90 disabled:cursor-default disabled:opacity-40"
            >
              {loading ? <Square className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default AiPanel;