"use client";

import { useAiPanel } from "@/hooks/use-ai-panel";
import { cn } from "@/lib/utils";
import { useSupabaseUser } from "@/hooks/use-supabase-user";
import { useRefresh } from "@/hooks/use-refresh";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bot, Send, Sparkles, X, Loader2, AlertTriangle, Check, Ban } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { remove } from "@/lib/db";

interface PendingAction {
  type: "delete";
  noteId: string;
  title: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  pendingAction?: PendingAction;
}

const AiPanel = () => {
  const { isOpen, onClose } = useAiPanel();
  const { user } = useSupabaseUser();
  const triggerSidebar = useRefresh((s) => s.triggerSidebar);
  const params = useParams();
  const router = useRouter();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesRef.current?.scrollTo(0, messagesRef.current.scrollHeight);
  }, [messages, streaming]);

  if (!isOpen) return null;

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMsg: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setStreaming("");

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: input,
          documentId: params.documentId || undefined,
        }),
      });

      if (!response.ok) throw new Error("Request failed");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let fullText = "";
      let hasNavigated = false;
      let pendingAction: PendingAction | undefined;

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

        setStreaming(fullText);
      }

      const newMsg: Message = { role: "assistant", content: fullText, pendingAction };
      setMessages((prev) => [...prev, newMsg]);
      setStreaming("");
    } catch (err) {
      toast.error("AI 请求失败，请稍后再试");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmDelete = (msgIndex: number, noteId: string, title: string) => {
    const promise = remove(noteId).then(() => {
      triggerSidebar();
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
        "fixed right-0 top-0 h-full w-96 border-l bg-white dark:bg-neutral-900 dark:border-neutral-800 z-[101] flex flex-col shadow-xl"
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

              {/* 删除确认按钮 */}
              {msg.pendingAction?.type === "delete" && (
                <div className="flex gap-2 justify-start pl-6">
                  <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2.5 flex items-center gap-3">
                    <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium text-red-800 dark:text-red-200">
                        确认永久删除「{msg.pendingAction.title}」？
                      </p>
                      <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                        此操作不可撤销
                      </p>
                    </div>
                    <div className="flex gap-1.5 ml-2">
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
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs cursor-pointer"
                        onClick={() => handleCancelDelete(i)}
                      >
                        <Ban className="h-3.5 w-3.5 mr-1" />
                        取消
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
            <div className="flex items-center gap-2 text-neutral-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-xs">思考中...</span>
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
