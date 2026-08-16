"use client";

import { useLayout } from "@/hooks/use-layout";
import { cn } from "@/lib/utils";
import { useUser } from "@/hooks/use-user";
import { useRefresh } from "@/hooks/use-refresh";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bot, Send, Sparkles, X, Loader2, AlertTriangle, Check, Ban, MessageSquare, Plus, Trash2, History, Square } from "lucide-react";
import { Button } from "../../../components/ui/button";
import MentionInput, { type MentionInputHandle } from "./mention-input";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { getChatHistory, getChatSessions, createChatSession, deleteChatSession, getById, remove, type ChatSession } from "@/lib/db";
import { truncateMentionTitle } from "@/lib/mention";

interface PendingAction {
  type: "delete";
  noteId: string;
  title: string;
}

interface Reference {
  noteId: string;
  title: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  pendingAction?: PendingAction;
  references?: Reference[];
}

/** 服务端 SSE 事件（与 lib/agent.ts 的 AgentStreamEvent 对应，事件与文本分通道） */
type SseEvent =
  | { type: "text"; text: string }
  | { type: "progress"; label: string }
  | { type: "note_created"; noteId: string }
  | { type: "confirm_delete"; noteId: string; title: string }
  | { type: "note_modified"; noteId: string }
  | { type: "references"; references: Reference[] }
  | { type: "error"; message: string };

const AiPanel = () => {
  // details 列由布局 store 控制：0 宽 = 关闭（保持挂载），>0 = 打开。
  const detailsOpen = useLayout((s) => s.details > 0);
  const closeDetails = useLayout((s) => s.closeDetails);
  const { user } = useUser();
  const triggerSidebar = useRefresh((s) => s.triggerSidebar);
  const triggerDocument = useRefresh((s) => s.triggerDocument);
  const params = useParams();
  const router = useRouter();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputEmpty, setInputEmpty] = useState(true);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [progress, setProgress] = useState("");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // setStreaming 的 rAF 节流：SSE 文本 chunk 到达频率可能高于帧率，
  // 同一帧内多次 setStreaming 合并为一次渲染（ReactMarkdown 全量重解析开销大）
  const streamingRaf = useRef<number | null>(null);
  const pendingStreamingRef = useRef("");
  // 流式文本更新（rAF 节流）：最新文本存入 ref，每帧最多触发一次 setStreaming
  const scheduleStreaming = (text: string) => {
    pendingStreamingRef.current = text;
    if (streamingRaf.current !== null) return;
    streamingRaf.current = requestAnimationFrame(() => {
      streamingRaf.current = null;
      setStreaming(pendingStreamingRef.current);
    });
  };

  // 取消未执行的 rAF 并清空待渲染文本：
  // 流结束/中止时若不取消，已排队的回调会在下一帧把 streaming 置回最后一段文本，
  // 消息列表下方残留重复的"幽灵流"气泡
  const cancelStreamingFlush = () => {
    if (streamingRaf.current !== null) {
      cancelAnimationFrame(streamingRaf.current);
      streamingRaf.current = null;
    }
    pendingStreamingRef.current = "";
  };

  // 卸载时取消未执行的 rAF
  useEffect(() => {
    return () => cancelStreamingFlush();
  }, []);

  const messagesRef = useRef<HTMLDivElement>(null);
  // 流式请求控制：当前是否在生成、终止用 AbortController、待发送队列（含会话快照）
  const streamingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<Array<{ content: string; sessionId: string }>>([]);
  const [queueItems, setQueueItems] = useState<Array<{ content: string; sessionId: string }>>([]);
  const mentionRef = useRef<MentionInputHandle>(null);
  // 当前激活会话 ref：abort 分支区分"用户手动停止"与"切换会话导致的中止"
  const activeSessionRef = useRef<string | null>(null);
  activeSessionRef.current = activeSessionId;

  // 宽度由 AppShell 拖拽手柄 + 布局 store 控制（本面板不再自拖拽）。

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
    return () => {
      alive = false;
    };
  }, [userId]);

  // 切换会话时加载该会话的历史（跨文档全局对话）
  useEffect(() => {
    if (!userId || !activeSessionId) return;
    // 切换会话：中止上一会话的流式请求，防止旧流的文本/loading 污染新会话
    if (streamingRef.current && abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      streamingRef.current = false;
      setLoading(false);
      setStreaming("");
      setProgress("");
      cancelStreamingFlush();
    }
    let alive = true;
    getChatHistory(userId, activeSessionId)
      .then((msgs) => {
        if (!alive) return;
        setMessages(msgs.map((m) => ({ role: m.role, content: m.content })));
      })
      .catch(() => {
        // 历史拉取失败不阻塞，保持空对话
      });
    return () => {
      alive = false;
    };
  }, [userId, activeSessionId]);

  useEffect(() => {
    messagesRef.current?.scrollTo(0, messagesRef.current.scrollHeight);
  }, [messages, streaming]);

  // 每次打开面板都滚到最新消息（关闭时 state 保留，消息不变化不会触发上面的 effect）
  useEffect(() => {
    if (detailsOpen) {
      messagesRef.current?.scrollTo(0, messagesRef.current.scrollHeight);
    }
  }, [detailsOpen]);

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
    if (active?.title === "新对话") {
      return;
    }
    try {
      const id = await createChatSession(user.id);
      setSessions((prev) => [
        { id, title: "新对话", createdAt: "", updatedAt: "" },
        ...prev,
      ]);
      setActiveSessionId(id);
      setMessages([]);
      setStreaming("");
      setProgress("");
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
          setMessages([]);
        }
      }
    } catch {
      toast.error("删除会话失败");
    }
  };

  // 真正发起请求：首次发送与队列调度共用（不检查 loading，由 streamingRef 保证不并发）。
  // sessionId 为发起时快照：队列中的消息即使期间切换会话，仍发到入队时的会话。
  const sendMessage = async (content: string, sessionId: string) => {
    if (!content || !sessionId) return;
    streamingRef.current = true;

    const userMsg: Message = { role: "user", content };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    setStreaming("");
    setProgress("");
    cancelStreamingFlush();

    const controller = new AbortController();
    abortRef.current = controller;

    let fullText = "";
    let pendingAction: PendingAction | undefined;
    let pendingRefs: Reference[] | undefined;

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
      let hasNavigated = false;

      // SSE 事件解析：服务端以 `data: <json>\n\n` 输出，text/progress/
      // note_created/confirm_delete/note_modified/references 分通道，不再与 AI 文本混流
      const handleEvent = (event: SseEvent) => {
        switch (event.type) {
          case "text":
            fullText += event.text;
            scheduleStreaming(fullText);
            break;
          case "progress":
            setProgress(event.label);
            break;
          case "note_created":
            if (!hasNavigated) {
              hasNavigated = true;
              setTimeout(() => {
                router.push(`/documents/${event.noteId}`);
              }, 800);
            }
            break;
          case "confirm_delete":
            if (!pendingAction) {
              pendingAction = { type: "delete", noteId: event.noteId, title: event.title };
            }
            break;
          case "note_modified":
            triggerDocument(event.noteId);
            triggerSidebar();
            break;
          case "references":
            pendingRefs = event.references;
            break;
          case "error":
            // 生成中途出错（模型 API 异常等）：明确提示，避免静默断流
            toast.error(`AI 生成出错：${event.message}`);
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

      const newMsg: Message = { role: "assistant", content: fullText, pendingAction, references: pendingRefs };
      setMessages((prev) => [...prev, newMsg]);
      setStreaming("");
      setProgress("");
      cancelStreamingFlush();
      refreshSessions(); // 刷新会话列表（首个问题会自动命名会话）
    } catch (err) {
      if (controller.signal.aborted) {
        // 用户主动停止（同一会话）：保留已生成的部分内容；
        // 切换会话导致的中止（activeSessionId 已变）不追加，避免旧流文本污染新会话
        const partial = fullText.trim();
        if (partial && activeSessionRef.current === sessionId) {
          setMessages((prev) => [...prev, { role: "assistant", content: partial }]);
        }
        setStreaming("");
        setProgress("");
        cancelStreamingFlush();
        // 仅用户主动停止（仍是发起时会话）时提示；切换会话导致的中止不打扰
        if (activeSessionRef.current === sessionId) {
          toast.info("已停止生成");
        }
      } else {
        // 网络/服务端错误：清理流式状态，避免残留部分文本
        setStreaming("");
        setProgress("");
        cancelStreamingFlush();
        toast.error(
          err instanceof Error && err.message === "DuplicateRequest"
            ? "请求已提交，请勿重复发送"
            : "AI 请求失败，请稍后再试"
        );
      }
    } finally {
      // 归属校验：请求已被会话切换接管（abortRef 被置 null）时不调度队列/清理状态，
      // 避免旧流的 finally 把下一条队列消息发到错误时机
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
      .then(() => router.push(`/documents/${id}`))
      .catch(() => toast.error("文档不存在或已删除"));
  };

  // 移除队列中的一条消息
  const removeFromQueue = (index: number) => {
    queueRef.current = queueRef.current.filter((_, i) => i !== index);
    setQueueItems([...queueRef.current]);
  };

  // 清空整个队列
  const clearQueue = () => {
    queueRef.current = [];
    setQueueItems([]);
  };

  // 用户消息里的 [@标题](id) 提及 → 胶囊（不做完整 markdown 渲染，避免改变用户原文）
  const renderMentions = (text: string) => {
    const parts = text.split(/(\[@[^\]]+\]\([a-zA-Z0-9-]{3,64}\))/g);
    return parts.map((part, index) => {
      const m = part.match(/^\[@([^\]]+)\]\(([a-zA-Z0-9-]{3,64})\)$/);
      if (m) {
        return (
          <button
            key={index}
            type="button"
            title={m[2]}
            onClick={() => openDocument(m[2])}
            className="mention-chip cursor-pointer"
          >
            <span>@{truncateMentionTitle(m[1])}</span>
          </button>
        );
      }
      return <span key={index}>{part}</span>;
    });
  };


  const handleConfirmDelete = (msgIndex: number, noteId: string, title: string) => {
    const promise = remove(noteId).then(() => {
      triggerSidebar();
      // 如果当前正在查看被删除的文档，跳转到文档列表
      if (params.documentId === noteId) {
        router.push("/documents");
      }
      // 清除该消息的 pendingAction
      setMessages((prev) =>
        prev.map((m, i) => (i === msgIndex ? { ...m, pendingAction: undefined } : m))
      );
    });

    toast.promise(promise, {
      loading: `正在删除「${title}」...`,
      success: `「${title}」已永久删除`,
      error: "删除失败",
    });
  };

  const handleCancelDelete = (msgIndex: number) => {
    setMessages((prev) =>
      prev.map((m, i) => (i === msgIndex ? { ...m, pendingAction: undefined } : m))
    );
    toast.info("已取消删除");
  };

  return (
    <aside className="flex h-full min-w-0 flex-col overflow-hidden border-l border-shell-border bg-shell-bg-base">
      {/* DSH DetailsPanel 风格头部：pad 14/12/12/12，标题 14/20 wt500，28px 圆形操作 */}
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
            <DropdownMenuContent align="end" className="w-64 max-h-80 overflow-y-auto">
              {sessions.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">暂无历史会话</div>
              )}
              {sessions.map((s) => (
                <DropdownMenuItem
                  key={s.id}
                  onClick={() => setActiveSessionId(s.id)}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate flex-1">{s.title}</span>
                  {s.id === activeSessionId && <Check className="h-3.5 w-3.5 shrink-0 text-foreground" />}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSession(s.id);
                    }}
                    className={cn(
                      "shrink-0 rounded p-0.5 hover:bg-destructive/10 hover:text-destructive cursor-pointer",
                      confirmingDeleteId === s.id
                        ? "text-destructive bg-destructive/10"
                        : "text-muted-foreground"
                    )}
                    title={confirmingDeleteId === s.id ? "再次点击确认删除" : "删除会话"}
                  >
                    {confirmingDeleteId === s.id ? (
                      <span className="text-[10px] px-0.5 font-medium">确认?</span>
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

        <div ref={messagesRef} className="relative min-h-0 flex-1 overflow-y-auto">
          <div className="flex min-h-full flex-col gap-5 px-4 py-5">
          {messages.length === 0 && !loading && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 pb-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ai text-ai-foreground shadow-md">
                <Bot className="h-7 w-7" />
              </div>
              <div className="space-y-1.5">
                <p className="text-[26px] font-medium leading-8 text-shell-label-primary">
                  你好，我是你的笔记助手
                </p>
                <p className="text-[13px] leading-5 text-shell-label-tertiary">
                  帮你总结文档、改进写作、回答问题。
                  <br />
                  写新笔记时我会直接创建，你确认或丢弃即可。
                </p>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className="space-y-2">
              {msg.role === "user" ? (
                <div className="flex justify-end">
                  {/* DSH 用户气泡：右对齐、22px 圆角、专用气泡色（ai-muted 呼应荧光笔品牌） */}
                  <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[22px] bg-ai-muted px-4 py-2.5 text-[15px] leading-6 text-shell-label-primary">
                    {renderMentions(msg.content)}
                  </div>
                </div>
              ) : (
                <div className="prose prose-sm dark:prose-invert max-w-none text-[15px] leading-6 text-shell-label-primary prose-headings:my-1.5 prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-code:bg-shell-row-active prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-pre:bg-shell-row-active prose-pre:text-xs">
                  {msg.content ? (
                    <ReactMarkdown
                      components={{
                        a: ({ href, children }) => {
                          // 文档提及胶囊：[@标题](文档id) → 与输入框胶囊同款样式，点击跳转文档
                          const text = Array.isArray(children)
                            ? children.map(String).join("")
                            : String(children ?? "");
                          if (text.startsWith("@") && href && /^[a-zA-Z0-9-]{3,64}$/.test(href)) {
                            return (
                              <button
                                type="button"
                                title={href}
                                onClick={() => openDocument(href)}
                                className="mention-chip cursor-pointer"
                              >
                                <span>{"@" + truncateMentionTitle(text.slice(1))}</span>
                              </button>
                            );
                          }
                          return (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-foreground underline"
                            >
                              {children}
                            </a>
                          );
                        },
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  ) : (
                    <span className="italic text-shell-label-tertiary">（空回复）</span>
                  )}
                </div>
              )}

              {/* 引用来源：DSH refChip——accent 色调小圆片，点击跳转 */}
              {msg.role === "assistant" && msg.references && msg.references.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {msg.references.map((ref) => (
                    <button
                      key={ref.noteId}
                      onClick={() => openDocument(ref.noteId)}
                      className="inline-flex max-w-[240px] cursor-pointer items-center gap-1.5 rounded-lg bg-[color-mix(in_srgb,var(--shell-accent)_18%,transparent)] px-2.5 py-1 text-xs text-shell-label-primary transition-colors hover:bg-[color-mix(in_srgb,var(--shell-accent)_28%,transparent)]"
                    >
                      <span className="shrink-0">📄</span>
                      <span className="truncate">{ref.title}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* 删除确认：DSH danger notice 卡片 */}
              {msg.pendingAction?.type === "delete" && (
                <div className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-destructive">
                          确认永久删除「{msg.pendingAction.title}」？
                        </p>
                        <p className="text-xs text-destructive/80 mt-0.5">
                          此操作不可撤销
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-2.5 justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs cursor-pointer"
                        onClick={() => handleCancelDelete(i)}
                      >
                        <Ban className="h-3.5 w-3.5 mr-1" />
                        取消
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 text-xs cursor-pointer"
                        onClick={() =>
                          handleConfirmDelete(i, msg.pendingAction!.noteId, msg.pendingAction!.title)
                        }
                      >
                        <Check className="h-3.5 w-3.5 mr-1" />
                        确认删除
                      </Button>
                    </div>
                  </div>
              )}
            </div>
          ))}

          {streaming && (
            <div className="whitespace-pre-wrap break-words text-[15px] leading-6 text-shell-label-primary">
              {streaming}
              <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-shell-accent align-middle" />
            </div>
          )}

          {loading && !streaming && (
            <div className="flex items-center gap-2 text-shell-label-tertiary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="text-xs leading-[18px]">{progress || "正在查找结果..."}</span>
            </div>
          )}
          {loading && streaming && (
            <div className="flex items-center gap-2 text-shell-label-tertiary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="text-xs leading-[18px]">正在回答...</span>
            </div>
          )}
          </div>
          {/* 消息流底部渐变 fade（DSH composer mask） */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-9 bg-gradient-to-t from-shell-bg-base to-transparent" />
        </div>

        <div className="shrink-0 px-3 pb-3 pt-1">
          {queueItems.length > 0 && (
            <div className="mb-3 rounded-xl border border-shell-border-l2 bg-shell-row-hover p-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-shell-label-secondary">
                  待发送队列（{queueItems.length}）
                </span>
                <button
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
                    <span className="flex-1 truncate text-xs text-shell-label-primary/80">{item.content}</span>
                    <button
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
              placeholder={loading ? "正在回答，输入后自动排队发送..." : "输入你的问题，@ 可提及文档..."}
              className="px-1 pt-2.5"
            />
            <div className="flex items-center justify-between gap-3 px-2 pb-1.5 pt-1">
              <div className="flex min-w-0 items-center gap-2 text-[11px] leading-[16px] text-shell-label-tertiary">
                {loading ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span className="truncate">{progress || "正在查找结果..."}</span>
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