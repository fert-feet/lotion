"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type DocumentSaveStatus = "idle" | "saving" | "saved" | "error";

interface DocumentAutosaveOptions {
  /** 每个字段独立命名空间，例如 lotion:autosave:v1:<docId>:content */
  storageKey: string;
  delay: number;
  save: (value: string) => Promise<void>;
  onSaved?: () => void;
}

interface DocumentAutosave {
  status: DocumentSaveStatus;
  error: string | null;
  recovery: string | null;
  schedule: (value: string) => void;
  flush: () => Promise<void>;
  retry: () => Promise<void>;
  discardRecovery: () => void;
}

function readRecovery(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRecovery(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 配额不足或隐私模式禁用 localStorage 时，仍保留内存中的保存与重试能力。
  }
}

function clearRecovery(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 忽略存储不可用。
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "保存失败，请稍后重试";
}

/**
 * 文档字段自动保存控制器。
 *
 * 关键语义：
 * - 同一字段的写入串行执行，避免旧请求晚到后覆盖新内容；
 * - 本地恢复稿在真正发出网络请求时写入，成功后只在最新值已保存时清除；
 * - 路由切换时 flush，浏览器离开时同步写恢复稿并触发未保存提示。
 */
export function useDocumentAutosave({
  storageKey,
  delay,
  save,
  onSaved,
}: DocumentAutosaveOptions): DocumentAutosave {
  const [status, setStatus] = useState<DocumentSaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<string | null>(() => readRecovery(storageKey));

  const storageKeyRef = useRef(storageKey);
  const latestRef = useRef<string | null>(null);
  const savedRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const saveRef = useRef(save);
  const onSavedRef = useRef(onSaved);
  saveRef.current = save;
  onSavedRef.current = onSaved;

  const flushFor = useCallback(async (key: string) => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const value = latestRef.current;
    if (value === null || value === savedRef.current) return;

    writeRecovery(key, value);
    setStatus("saving");
    setError(null);

    const run = chainRef.current
      .catch(() => undefined)
      .then(() => saveRef.current(value));
    chainRef.current = run.catch(() => undefined);

    try {
      await run;
      savedRef.current = value;
      if (storageKeyRef.current === key) {
        setStatus("saved");
        setError(null);
        onSavedRef.current?.();
        if (latestRef.current === value) {
          clearRecovery(key);
          setRecovery(null);
        } else {
          setRecovery(latestRef.current);
        }
      }
    } catch (err) {
      if (storageKeyRef.current === key) {
        setStatus("error");
        setError(messageOf(err));
        setRecovery(value);
      }
    }
  }, []);

  const flush = useCallback(() => flushFor(storageKeyRef.current), [flushFor]);

  const schedule = useCallback(
    (value: string) => {
      latestRef.current = value;
      setStatus("saving");
      setError(null);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void flush();
      }, delay);
    },
    [delay, flush],
  );

  const retry = useCallback(() => {
    if (latestRef.current === null && recovery !== null) latestRef.current = recovery;
    return flush();
  }, [flush, recovery]);

  const discardRecovery = useCallback(() => {
    clearRecovery(storageKeyRef.current);
    setRecovery(null);
  }, []);

  // 文档切换：先把旧字段写到旧 key，再切换到新字段的恢复稿和空白基线。
  useEffect(() => {
    const previousKey = storageKeyRef.current;
    if (previousKey === storageKey) return;
    void flushFor(previousKey);
    storageKeyRef.current = storageKey;
    latestRef.current = null;
    savedRef.current = null;
    chainRef.current = Promise.resolve();
    setStatus("idle");
    setError(null);
    setRecovery(readRecovery(storageKey));
  }, [flushFor, storageKey]);

  // 卸载或页面离开：清理计时器并尽力 flush；本地恢复稿保证网络请求没赶上时仍可找回。
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (latestRef.current === null || latestRef.current === savedRef.current) return;
      writeRecovery(storageKeyRef.current, latestRef.current);
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      void flushFor(storageKeyRef.current);
    };
  }, [flushFor]);

  return { status, error, recovery, schedule, flush, retry, discardRecovery };
}
