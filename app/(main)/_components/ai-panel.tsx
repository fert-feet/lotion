"use client";

import { useAiPanel } from "@/hooks/use-ai-panel";
import { cn } from "@/lib/utils";
import { useSupabaseUser } from "@/hooks/use-supabase-user";
import { useRefresh } from "@/hooks/use-refresh";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bot, Send, Sparkles, X, Loader2, AlertTriangle, Check, Ban, MessageSquare, Plus, Trash2, History } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import {
  getChatHistory,
  getChatSessions,
  createChatSession,
  deleteChatSession,
  remove,
  type ChatSession,
} from "@/lib/db";

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
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [progress, setProgress] = useState("");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

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

  const handleSend = async () => {
    if (!input.trim() || loading || !activeSessionId) return;

    const userMsg: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setStreaming("");
    setProgress("");

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: input,
          documentId: params.documentId || undefined,
          sessionId: activeSessionId,
          requestId: crypto.randomUUID(), // 服务端幂等，防重复提交
        }),
      });

      if (!response.ok) throw new Error("Request failed");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let fullText = "";
      let hasNavigated = false;
      let pendingAction: PendingAction | undefined;
      let pendingRefs: Reference[] | undefined;

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
      toast.error("AI 请求失败，请稍后再试");
    } finally {
      setLoading(false);
    }
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
      <div className="fixed inset-0 z-[100]" onClick={onClose} />
      <aside className={cn(
        // z-[100000] > navbar/banner 的 z-[99999]：面板打开时不被顶部文档栏盖住
        "fixed right-0 top-0 h-full w-96 border-l bg-white dark:bg-neutral-900 dark:border-neutral-800 z-[100000] flex flex-col shadow-xl"
      )}>
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-500" />
            <span className="font-semibold text-sm">AI 助手</span>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* 会话工具栏：当前标题 + 新增 + 历史下拉（同一时间只展示一个会话） */}
        <div className="border-b dark:border-neutral-800 px-3 py-2 flex items-center gap-1.5 shrink-0">
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
                  {s.id === activeSessionId && <Check className="h-3.5 w-3.5 shrink-0 text-blue-500" />}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSession(s.id);
                    }}
                    className={cn(
                      "shrink-0 rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900/40 hover:text-red-500 cursor-pointer",
                      confirmingDeleteId === s.id
                        ? "text-red-500 bg-red-100 dark:bg-red-900/40"
                        : "text-neutral-400"
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
        </div>

        <div ref={messagesRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-neutral-400">
              <Bot className="h-12 w-12" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
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
                  <div className="flex-shrink-0 mt-0.5">
                    <Sparkles className="h-4 w-4 text-blue-500" />
                  </div>
                )}
                <div
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm max-w-[85%]",
                    msg.role === "user"
                      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 whitespace-pre-wrap"
                      : "bg-neutral-100 dark:bg-neutral-800 prose prose-sm dark:prose-invert max-w-none prose-headings:my-1 prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-code:bg-neutral-200 dark:prose-code:bg-neutral-700 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-pre:bg-neutral-200 dark:prose-pre:bg-neutral-800 prose-pre:text-xs"
                  )}
                >
                  {msg.role === "assistant" && msg.content ? (
                    <ReactMarkdown
                      components={{
                        a: ({ href, children }) => (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 underline"
                          >
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  ) : msg.role === "assistant" ? (
                    <span className="text-muted-foreground italic">（空回复）</span>
                  ) : (
                    msg.content
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
                      className="inline-flex items-center gap-1 rounded-full border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-2.5 py-1 text-xs text-muted-foreground hover:text-blue-500 hover:border-blue-300 dark:hover:border-blue-700 transition-colors cursor-pointer max-w-[240px]"
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
                  <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2.5 w-full max-w-[85%]">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-red-800 dark:text-red-200">
                          确认永久删除「{msg.pendingAction.title}」？
                        </p>
                        <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
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
              <div className="flex-shrink-0 mt-0.5">
                <Sparkles className="h-4 w-4 text-blue-500" />
              </div>
              <div className="rounded-lg px-3 py-2 text-sm max-w-[85%] bg-neutral-100 dark:bg-neutral-800 whitespace-pre-wrap">
                {streaming}
                <span className="inline-block w-1 h-4 bg-blue-500 ml-0.5 animate-pulse" />
              </div>
            </div>
          )}

          {loading && !streaming && (
            <div className="flex items-center gap-2 text-neutral-400 pl-1">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-xs">{progress || "正在查找结果..."}</span>
            </div>
          )}
          {loading && streaming && (
            <div className="flex items-center gap-2 text-neutral-400 pl-1">
              <Loader2 className="h-3.5 w-3.5" />
              <span className="text-xs">正在回答...</span>
            </div>
          )}
        </div>

        <div className="border-t dark:border-neutral-800 p-4">
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="输入你的问题..."
              className="flex-1 rounded-md border px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800 focus:outline-none focus:ring-1 focus:ring-neutral-400"
              disabled={loading}
            />
            <Button
              size="icon"
              className="h-9 w-9 cursor-pointer"
              onClick={handleSend}
              disabled={loading || !input.trim()}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
};

export default AiPanel;
