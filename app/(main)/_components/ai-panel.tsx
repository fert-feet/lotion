"use client";

import { useAiPanel } from "@/hooks/use-ai-panel";
import { cn } from "@/lib/utils";
import { useSupabaseUser } from "@/hooks/use-supabase-user";
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
import { getChatHistory, getChatSessions, createChatSession, deleteChatSession, remove, type ChatSession } from "@/lib/db";
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

const AiPanel = () => {
  const { isOpen, onClose } = useAiPanel();
  const { user } = useSupabaseUser();
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
  const [navHeight, setNavHeight] = useState(0);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  // 流式请求控制：当前是否在生成、终止用 AbortController、待发送队列
  const streamingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<string[]>([]);
  const [queueItems, setQueueItems] = useState<string[]>([]);
  const mentionRef = useRef<MentionInputHandle>(null);

  // 面板打开时点击面板外部任意位置关闭。
  // 不用全屏遮罩（fixed inset-0 会拦截滚轮，导致文档无法滚动），
  // 改用 document 级 mousedown 判断点击是否在面板内。
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      // 面板内部点击不关闭
      if (panelRef.current?.contains(target)) return;
      // Radix 下拉/弹层渲染在 portal（body 下），点击其内容（如"历史"下拉项）不应关闭面板
      if (target instanceof Element && target.closest("[data-radix-popper-content-wrapper]")) return;
      onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen, onClose]);

  // 面板顶部卡在 navbar/banner 下方：实时测量顶部文档栏高度
  // （banner 出现/消失、侧边栏折叠都会改变高度，用 ResizeObserver 跟随）
  useEffect(() => {
    if (!isOpen) return;
    const el = document.getElementById("main-navbar");
    if (!el) return;
    const measure = () => setNavHeight(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isOpen]);

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
    let alive = true;
    getChatHistory(userId, activeSessionId, 20)
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

  if (!isOpen) return null;

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

  // 真正发起请求：首次发送与队列调度共用（不检查 loading，由 streamingRef 保证不并发）
  const sendMessage = async (content: string) => {
    if (!content || !activeSessionId) return;
    streamingRef.current = true;

    const userMsg: Message = { role: "user", content };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    setStreaming("");
    setProgress("");

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
          documentId: params.documentId || undefined,
          sessionId: activeSessionId,
          requestId: crypto.randomUUID(), // 服务端幂等，防重复提交
        }),
        signal: controller.signal, // 终止按钮 abort 此请求
      });

      if (!response.ok) throw new Error("Request failed");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let hasNavigated = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        fullText += decoder.decode(value, { stream: true });

        if (!hasNavigated) {
          const noteMatch = fullText.match(/\[NOTE_CREATED:([^\]]+)\]/);
          if (noteMatch) {
            hasNavigated = true;
            const docId = noteMatch[1];
            fullText = fullText.replace(/\[NOTE_CREATED:[^\]]+\]/, "");
            setTimeout(() => {
              router.push(`/documents/${docId}`);
            }, 800);
          }
        }

        // 检测删除确认标记
        if (!pendingAction) {
          const confirmMatch = fullText.match(/\[CONFIRM_DELETE:([^:]+):([^\]]+)\]/);
          if (confirmMatch) {
            const noteId = confirmMatch[1];
            const title = decodeURIComponent(confirmMatch[2]);
            pendingAction = { type: "delete", noteId, title };
            fullText = fullText.replace(/\[CONFIRM_DELETE:[^\]]+\]/, "");
          }
        }

        // 检测文档修改标记（updateNote / renameNote 触发的刷新）
        const modMatch = fullText.match(/\[NOTE_MODIFIED:([^\]]+)\]/);
        if (modMatch) {
          const modifiedId = modMatch[1];
          fullText = fullText.replace(/\[NOTE_MODIFIED:[^\]]+\]/, "");
          triggerDocument(modifiedId);
          triggerSidebar();
        }

        // 检测引用来源标记（readNote 读过的笔记 → 可点击跳转）
        const refMatch = fullText.match(/\[REFERENCES:([^\]]+)\]/);
        if (refMatch) {
          pendingRefs = refMatch[1].split("|").map((part) => {
            const [noteId, ...titleParts] = part.split(":");
            return { noteId, title: decodeURIComponent(titleParts.join(":")) };
          });
          fullText = fullText.replace(/\[REFERENCES:[^\]]+\]/, "");
        }

        // 检测进度消息
        const progMatch = fullText.match(/\[PROGRESS:(.+?)\]/);
        if (progMatch) {
          setProgress(progMatch[1]);
          fullText = fullText.replace(/\[PROGRESS:[^\]]+\]/, "");
        }

        setStreaming(fullText);
      }

      const newMsg: Message = { role: "assistant", content: fullText, pendingAction, references: pendingRefs };
      setMessages((prev) => [...prev, newMsg]);
      setStreaming("");
      setProgress("");
      refreshSessions(); // 刷新会话列表（首个问题会自动命名会话）
    } catch (err) {
      if (controller.signal.aborted) {
        // 用户主动终止：保留已生成的部分内容，并清理未闭合的标记残留
        const partial = fullText.replace(/\[[^\]]*$/, "").trim();
        if (partial) {
          setMessages((prev) => [...prev, { role: "assistant", content: partial }]);
        }
        setStreaming("");
        setProgress("");
        toast.info("已停止生成");
      } else {
        toast.error("AI 请求失败，请稍后再试");
      }
    } finally {
      streamingRef.current = false;
      setLoading(false);
      abortRef.current = null;
      // 队列调度：当前请求结束（正常/终止/失败）后自动发送下一条
      const next = queueRef.current.shift();
      setQueueItems([...queueRef.current]);
      if (next) {
        setTimeout(() => sendMessage(next), 60);
      }
    }
  };

  // 输入框发送入口：流式进行中则入队排队，结束后自动发送
  const handleSend = (content: string) => {
    if (!content || !activeSessionId) return;

    if (streamingRef.current) {
      queueRef.current = [...queueRef.current, content];
      setQueueItems([...queueRef.current]);
      return;
    }

    void sendMessage(content);
  };

  // 终止当前流式生成（服务端通过 abortSignal 同步中断）
  const handleStop = () => {
    abortRef.current?.abort();
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
            onClick={() => router.push(`/documents/${m[2]}`)}
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
    <>
      <aside
        ref={panelRef}
        style={{ top: navHeight }}
        className={cn(
          "fixed right-0 bottom-0 w-96 border-l border-t bg-background z-[101] flex flex-col shadow-xl"
        )}
      >
        {/* 会话工具栏：当前标题 + 历史下拉 + 新增 + 关闭（原"AI 助手"标题栏已去掉，
            面板顶部刚好卡在 navbar/banner 下方） */}
        <div className="border-b px-3 py-2 flex items-center gap-1.5 shrink-0">
          <span className="flex-1 truncate text-sm font-medium text-muted-foreground min-w-0">
            {sessions.find((s) => s.id === activeSessionId)?.title ?? "新对话"}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground cursor-pointer">
                <History className="h-4 w-4" />
                <span>历史</span>
              </Button>
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
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-muted-foreground cursor-pointer"
            onClick={handleNewSession}
          >
            <Plus className="h-4 w-4" />
            <span>新增</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground cursor-pointer"
            onClick={onClose}
            title="关闭"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div ref={messagesRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-muted-foreground">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-foreground text-background shadow-md">
                <Bot className="h-7 w-7" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  你好，我是你的笔记助手
                </p>
                <p className="text-xs">
                  帮你总结文档、改进写作、回答问题。
                  <br />
                  写新笔记时我会直接创建，你确认或丢弃即可。
                </p>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className="space-y-2">
              <div
                className={cn(
                  "flex gap-2",
                  msg.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                {msg.role === "assistant" && (
                  <div className="flex flex-col items-center gap-0.5 shrink-0 mt-0.5">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background">
                      <Sparkles className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-[9px] font-semibold leading-none text-muted-foreground">AI</span>
                  </div>
                )}
                <div
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm max-w-[85%]",
                    msg.role === "user"
                      ? "bg-muted whitespace-pre-wrap"
                      : "bg-muted prose prose-sm dark:prose-invert max-w-none prose-headings:my-1 prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-pre:bg-muted prose-pre:text-xs"
                  )}
                >
                  {msg.role === "assistant" && msg.content ? (
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
                                onClick={() => router.push(`/documents/${href}`)}
                                className="mention-chip cursor-pointer"
                              >
                                <span>{`@${truncateMentionTitle(text.slice(1))}`}</span>
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
                  ) : msg.role === "assistant" ? (
                    <span className="text-muted-foreground italic">（空回复）</span>
                  ) : (
                    renderMentions(msg.content)
                  )}
                </div>
              </div>

              {/* 引用来源：AI 读取过的笔记，可点击跳转 */}
              {msg.role === "assistant" && msg.references && msg.references.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pl-6">
                  {msg.references.map((ref) => (
                    <button
                      key={ref.noteId}
                      onClick={() => router.push(`/documents/${ref.noteId}`)}
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors cursor-pointer max-w-[240px]"
                    >
                      <span className="shrink-0">📄</span>
                      <span className="truncate">{ref.title}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* 删除确认按钮 */}
              {msg.pendingAction?.type === "delete" && (
                <div className="flex justify-start pl-6">
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 w-full max-w-[85%]">
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
                </div>
              )}
            </div>
          ))}

          {streaming && (
            <div className="flex gap-2 justify-start">
              <div className="flex flex-col items-center gap-0.5 shrink-0 mt-0.5">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background">
                  <Sparkles className="h-3.5 w-3.5" />
                </div>
                <span className="text-[9px] font-semibold leading-none text-muted-foreground">AI</span>
              </div>
              <div className="rounded-lg px-3 py-2 text-sm max-w-[85%] bg-muted whitespace-pre-wrap">
                {streaming}
                <span className="inline-block w-1 h-4 bg-foreground ml-0.5 animate-pulse" />
              </div>
            </div>
          )}

          {loading && !streaming && (
            <div className="flex items-center gap-2 text-muted-foreground pl-1">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-xs">{progress || "正在查找结果..."}</span>
            </div>
          )}
          {loading && streaming && (
            <div className="flex items-center gap-2 text-muted-foreground pl-1">
              <Loader2 className="h-3.5 w-3.5" />
              <span className="text-xs">正在回答...</span>
            </div>
          )}
        </div>

        <div className="border-t p-4">
          {queueItems.length > 0 && (
            <div className="mb-3 rounded-md border border-border bg-muted/50 p-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  待发送队列（{queueItems.length}）
                </span>
                <button
                  onClick={clearQueue}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  清空
                </button>
              </div>
              <div className="space-y-1 max-h-28 overflow-y-auto">
                {queueItems.map((item, index) => (
                  <div
                    key={`${index}-${item}`}
                    className="flex items-center gap-2 rounded-sm bg-background/60 px-2 py-1"
                  >
                    <span className="flex-1 truncate text-xs text-foreground/80">{item}</span>
                    <button
                      onClick={() => removeFromQueue(index)}
                      title="移除该条"
                      className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <MentionInput
              ref={mentionRef}
              onSubmit={handleSend}
              onEmptyChange={setInputEmpty}
              placeholder={loading ? "正在回答，输入后自动排队发送..." : "输入你的问题，@ 可提及文档..."}
              className="flex-1"
            />
            <div className="shrink-0">
              <Button
                size="icon"
                className="h-9 w-9 cursor-pointer bg-foreground text-background hover:bg-foreground/90"
                onClick={loading ? handleStop : () => mentionRef.current?.submit()}
                disabled={!loading && inputEmpty}
                title={loading ? "停止生成" : "发送"}
              >
                {loading ? <Square className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};

export default AiPanel;
