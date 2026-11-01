"use client";

// 插件配置弹窗：按 manifest 的 configFields 生成表单；没有字段时退化为 JSON 编辑器。
// 配置的持久化在宿主侧（settings patch / 已安装插件 manifest），这里只负责收集对象。
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { PluginConfigField, PluginInfo } from "@/lib/seams/plugins";

export interface PluginConfigDialogProps {
  plugin: PluginInfo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (config: Record<string, unknown>) => Promise<void>;
}

function initialValue(field: PluginConfigField, config: Record<string, unknown>): unknown {
  return config[field.key] ?? field.default ?? (field.type === "boolean" ? false : "");
}

/** 把表单值收敛回 JSON 可序列化类型 */
function normalise(field: PluginConfigField, raw: unknown): unknown {
  if (field.type === "number") {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  if (field.type === "boolean") return raw === true;
  return typeof raw === "string" ? raw : String(raw ?? "");
}

export function PluginConfigDialog({ plugin, open, onOpenChange, onSave }: PluginConfigDialogProps) {
  const fields = useMemo(() => plugin?.configFields ?? [], [plugin]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [json, setJson] = useState("{}");
  const [jsonMode, setJsonMode] = useState(fields.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!plugin) return;
    const next: Record<string, unknown> = {};
    for (const field of fields) next[field.key] = initialValue(field, plugin.config);
    setValues(next);
    setJson(JSON.stringify(plugin.config ?? {}, null, 2));
    setJsonMode(fields.length === 0);
    setError(null);
  }, [plugin, fields]);

  const save = async () => {
    setError(null);
    let config: Record<string, unknown>;
    if (jsonMode) {
      try {
        const parsed = JSON.parse(json) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("配置必须是 JSON 对象");
        }
        config = parsed as Record<string, unknown>;
      } catch (err) {
        setError(err instanceof Error ? err.message : "JSON 解析失败");
        return;
      }
    } else {
      config = {};
      for (const field of fields) config[field.key] = normalise(field, values[field.key]);
    }

    setSaving(true);
    try {
      await onSave(config);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px]">
        <DialogHeader className="border-b-[0.5px] border-shell-border pb-3 text-left">
          <DialogTitle>配置 · {plugin?.title ?? "插件"}</DialogTitle>
          <p className="text-[12px] text-shell-label-tertiary">
            配置写入后需要重启 / 刷新才会生效（静态插件）。
          </p>
        </DialogHeader>

        <div className="flex flex-col gap-3 pt-1">
          {jsonMode
            ? (
                <textarea
                  aria-label="插件配置 JSON"
                  value={json}
                  onChange={(event) => setJson(event.target.value)}
                  spellCheck={false}
                  className="min-h-[160px] w-full resize-y rounded-[8px] border-[0.5px] border-shell-border-l2 bg-card p-3 font-mono text-[12px] leading-5 text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
                />
              )
            : fields.map((field) => (
                <div key={field.key} className="flex flex-col gap-1.5">
                  <Label htmlFor={`plugin-config-${field.key}`}>{field.label}</Label>
                  {field.type === "boolean"
                    ? (
                        <label className="flex items-center gap-2 text-[13px] text-shell-label-secondary">
                          <input
                            id={`plugin-config-${field.key}`}
                            type="checkbox"
                            checked={values[field.key] === true}
                            onChange={(event) =>
                              setValues((prev) => ({ ...prev, [field.key]: event.target.checked }))
                            }
                          />
                          启用
                        </label>
                      )
                    : field.type === "select"
                      ? (
                          <select
                            id={`plugin-config-${field.key}`}
                            value={String(values[field.key] ?? "")}
                            onChange={(event) =>
                              setValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                            }
                            className="h-8 rounded-[6px] border-[0.5px] border-shell-border-l2 bg-card px-2 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
                          >
                            {(field.options ?? []).map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        )
                      : (
                          <Input
                            id={`plugin-config-${field.key}`}
                            type={field.type === "secret" ? "password" : field.type === "number" ? "number" : "text"}
                            value={String(values[field.key] ?? "")}
                            placeholder={field.placeholder}
                            onChange={(event) =>
                              setValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                            }
                          />
                        )}
                  {field.description ? (
                    <p className="text-[11px] text-shell-label-tertiary">{field.description}</p>
                  ) : null}
                </div>
              ))}

          {fields.length > 0 ? (
            <button
              type="button"
              className="self-start text-[12px] text-primary hover:underline"
              onClick={() => setJsonMode((prev) => !prev)}
            >
              {jsonMode ? "使用表单" : "高级：编辑 JSON"}
            </button>
          ) : null}

          {error ? (
            <p className={cn("rounded-[6px] bg-destructive/10 px-2.5 py-1.5 text-[12px] text-destructive")}>
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
