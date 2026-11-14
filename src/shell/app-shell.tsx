"use client";

// 三栏 shell（移植自 DSH packages/client/ui-layout/src/client/AppFrame.tsx 设计）：
// grid 轨道（sidebar | center | details）、拖拽手柄（pointer capture + rAF 节流）、
// 让步链（columns.ts）、窄屏自动折叠。sidebar 槽位按让步结果渲染（折叠时是 56px rail，
// 保持挂载）；details 槽位保持挂载，0 宽时仅视觉关闭。
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useParams } from "react-router";
import { MenuIcon } from "@/components/icons";
import { computeColumns, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT } from "@/lib/layout/columns";
import { useLayout, DETAILS_MODES, type DetailsMode } from "@/hooks/use-layout";
import Sidebar from "./sidebar/sidebar";
import Navbar from "./navbar";
import { useHasSlot, useSlot } from "@/src/kernel/react";
import { SLOT_DETAILS_PANEL } from "./ui-plugins";

/** 中心列 grid item（会话主体构建块）。
 *  relative + @container：编辑器大纲面板的定位基准（绝对定位）与可见性基准（容器查询按列宽，
 *  而非视口宽度）——否则打开 AI 面板后大纲会浮在 AI 面板之上。 */
function CenterColumn(props: { children?: ReactNode }) {
  // bg-background（纸张底）保持编辑器观感；shell 底色只用于侧边栏/详情栏
  return (
    <div className="@container relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
      {props.children}
    </div>
  );
}

/** 详情列内容：从 uiSlots 取（无插件贡献时渲染空列，而不是崩掉）。 */
function DetailsPanel() {
  const panel = useSlot(SLOT_DETAILS_PANEL);
  return <>{panel ?? null}</>;
}

/** 详情列 grid item；宽度 0 时保持子树挂载（关闭不卸载）。
 *  `overlay`：让步链把 details 压成 0（窗口放不下三栏）时改为右侧浮层——
 *  此时面板仍是同一个 React 位置，不重挂载、流式状态不丢（此前窄屏直接打不开 AI 面板）。 */
function DetailsColumn(props: { children?: ReactNode; overlay?: boolean }) {
  return (
    <div
      data-details-column
      data-details-overlay={props.overlay || undefined}
      className={
        props.overlay
          ? "material-sidebar fixed inset-y-0 right-0 z-chrome w-[min(440px,100vw)] min-w-0 overflow-hidden hairline-l border-shell-border shadow-elevation-3"
          : "material-sidebar min-w-0 overflow-hidden hairline-l border-shell-border"
      }
    >
      {/* 三种模式都渲染切换器：只放在全屏里会让“如何回去”变成隐藏知识。 */}
      <div className="flex h-full min-w-0 flex-col">
        <DetailsModeSwitch />
        <div className="min-h-0 flex-1">{props.children}</div>
      </div>
    </div>
  );
}

const DETAILS_MODE_LABEL: Record<DetailsMode, { label: string; hint: string }> = {
  docked: { label: "停靠", hint: "占一列，挤压正文（⌘J 开合）" },
  overlay: { label: "浮层", hint: "浮在正文之上，不挤压正文" },
  fullscreen: { label: "全屏", hint: "铺满正文区，专注对话（⌘⇧J 循环）" },
};

/**
 * 呈现模式切换器（停靠 / 浮层 / 全屏）。
 * 放在详情列头部而不是塞进 AI 面板插件：插槽内容仍由 ui-ai-panel 贡献，
 * 布局决策留在布局层——换面板不必重写一遍切换器。
 */
function DetailsModeSwitch() {
  const mode = useLayout((s) => s.detailsMode);
  const setMode = useLayout((s) => s.setDetailsMode);
  return (
    <div
      className="flex h-8 shrink-0 items-center gap-0.5 hairline-b border-shell-border px-1.5"
      role="group"
      aria-label="AI 面板呈现模式"
    >
      {DETAILS_MODES.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => setMode(id)}
          aria-pressed={mode === id}
          title={DETAILS_MODE_LABEL[id].hint}
          className={
            "h-6 cursor-pointer rounded-control px-2 text-ui-sm font-medium transition-colors " +
            (mode === id
              ? "bg-shell-row-active text-shell-label-primary"
              : "bg-transparent text-shell-label-secondary hover:bg-shell-row-hover hover:text-shell-label-primary")
          }
        >
          {DETAILS_MODE_LABEL[id].label}
        </button>
      ))}
    </div>
  );
}

/**
 * 一个拖拽手柄：pointer capture + rAF 节流 dx 上报。
 * `side` 键控 hover 显隐（details 显示悬浮 pill，sidebar 只留命中条）。
 */
function DragHandle(props: {
  side: "sidebar" | "details";
  left: number;
  onStart: () => void;
  onDrag: (dx: number) => void;
  onEnd: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const origin = useRef(0);
  const latest = useRef(0);
  const frame = useRef<number | null>(null);
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd });
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd };

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    origin.current = e.clientX;
    latest.current = e.clientX;
    callbacks.current.onStart();
    setDragging(true);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    latest.current = e.clientX;
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null;
      callbacks.current.onDrag(latest.current - origin.current);
    });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
    callbacks.current.onDrag(latest.current - origin.current);
    setDragging(false);
    callbacks.current.onEnd();
  }, []);

  const isDetails = props.side === "details";
  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={
        "absolute top-0 bottom-0 z-[2] -ml-1 w-2 cursor-col-resize touch-none " +
        "transition-[left] duration-300 ease-[var(--ds-ease-in-out)] " +
        (isDetails
          ? "after:absolute after:top-1/2 after:left-1/2 after:-translate-x-1/2 after:-translate-y-1/2 after:block after:h-8 after:w-3 after:rounded-card after:border after:border-shell-border-l2 after:bg-shell-bg-base after:opacity-0 after:transition-opacity after:duration-300 after:ease-[var(--ds-ease-in-out)] " +
            "hover:after:opacity-100 [&[data-dragging]]:after:opacity-100 [&[data-dragging]]:after:bg-shell-row-active"
          : "")
      }
      style={{ left: props.left }}
      data-side={props.side}
      data-dragging={dragging || undefined}
    />
  );
}

/** 非文档页顶栏：折叠时提供展开按钮。高度与文档页 Navbar 一致（h-11 = 44px）——
 *  页面切换时顶栏不能跳高度，这是全站唯一一条“顶栏”刻度。 */
function SlimTopBar(props: { collapsed: boolean; onExpand: () => void }) {
  return (
    <nav className="material-toolbar flex h-11 shrink-0 items-center hairline-b border-shell-border px-3">
      {props.collapsed && (
        <button
          type="button"
          onClick={props.onExpand}
          aria-label="展开侧边栏"
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-control text-shell-label-secondary hover:bg-shell-row-hover"
        >
          <MenuIcon className="h-5 w-5" />
        </button>
      )}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const params = useParams();
  const hasDocument = !!params.documentId;
  // 只订阅稳定 action（zustand action 引用恒定，useCallback 依赖稳定）
  const setSidebar = useLayout((s) => s.setSidebar);
  const setDetails = useLayout((s) => s.setDetails);
  const setNarrow = useLayout((s) => s.setNarrow);
  const toggleSidebar = useLayout((s) => s.toggleSidebar);
  const sidebar = useLayout((s) => s.sidebar);
  const narrow = useLayout((s) => s.narrow);
  const narrowExpanded = useLayout((s) => s.narrowExpanded);
  const details = useLayout((s) => s.details);
  const toggleDetails = useLayout((s) => s.toggleDetails);
  const closeDetails = useLayout((s) => s.closeDetails);
  const frameRef = useRef<HTMLDivElement | null>(null);
  // SSR 水合安全：首渲用固定宽（与服务端一致），挂载后 ResizeObserver 立即校正真实宽度
  const [viewport, setViewport] = useState(1440);

  // 窄屏自动折叠：折叠在 shell 层决定，求解器保持无断点。
  const autoNarrow = viewport < SIDEBAR_AUTO_COLLAPSE;
  useEffect(() => { setNarrow(autoNarrow); }, [autoNarrow, setNarrow]);
  const sidebarCollapsed = narrow ? !narrowExpanded : sidebar === 0;
  const sidebarPreference = sidebarCollapsed
    ? 0
    : sidebar === 0 ? SIDEBAR_DEFAULT : sidebar;
  const cols = computeColumns(viewport, sidebarPreference, details === 0 ? 0 : details);
  const colsRef = useRef(cols);
  colsRef.current = cols;
  const detailsMode = useLayout((s) => s.detailsMode);
  const cycleDetailsMode = useLayout((s) => s.cycleDetailsMode);
  // 详情列是否存在由插件决定：ui-ai-panel 被用户在设置里禁用时槽位无贡献者，
  // 此时"打开/切模式"一律不成立——否则详情列会作为一块空白壳挂在右边（入口能点、打开没内容）。
  const hasDetailsPanel = useHasSlot(SLOT_DETAILS_PANEL);
  const detailsOpen = hasDetailsPanel && details > 0;
  /** 全屏：details 铺满正文区，中心列压成 0（"读" 与 "聊" 两种模式，而非被迫挤压） */
  const detailsFullscreen = detailsOpen && detailsMode === "fullscreen";
  /** 浮层：用户显式选了浮层，或让步链把 details 压成 0（窗口放不下三栏） */
  const detailsOverlay =
    detailsOpen && !detailsFullscreen && (detailsMode === "overlay" || cols.details === 0);
  /** details 作为真实网格列时的宽度（浮层时占 0 列，但仍挂载） */
  const detailsColumnWidth = detailsOverlay ? 0 : cols.details;
  const gridTemplateColumns = detailsFullscreen
    ? [cols.sidebar + "px", "0px", "minmax(0, 1fr)"].join(" ")
    : [cols.sidebar + "px", "minmax(0, 1fr)", detailsColumnWidth + "px"].join(" ");

  // 跟踪 frame 自身盒宽（非窗口）：rAF 节流 ResizeObserver。
  useEffect(() => {
    const el = frameRef.current;
    if (el === null) return;
    let raf: number | null = null;
    const observer = new ResizeObserver(() => {
      raf ??= requestAnimationFrame(() => {
        raf = null;
        const width = el.getBoundingClientRect().width;
        if (width > 0) setViewport(width);
      });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, []);

  // ⌘J / Ctrl+J：开合右侧 AI 面板（对齐 DSH 的 details 列快捷键）
  // ⌘⇧J：循环呈现模式（停靠 → 浮层 → 全屏）
  useEffect(() => {
    // 没有详情列插件时快捷键不接管：⌘J 不应"打开一列空的"
    if (!hasDetailsPanel) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        if (e.shiftKey) cycleDetailsMode();
        else toggleDetails();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleDetails, cycleDetailsMode, hasDetailsPanel]);

  // 拖拽基准：抓取时定格当前渲染宽，整个手势期间冻结，dx 不叠加。
  const sidebarBase = useRef(0);
  const detailsBase = useRef(0);
  const [dragging, setDragging] = useState(false);
  const onDragEnd = useCallback(() => { setDragging(false); }, []);
  const onSidebarStart = useCallback(() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true); }, []);
  const onDetailsStart = useCallback(() => { detailsBase.current = colsRef.current.details; setDragging(true); }, []);
  const onSidebarDrag = useCallback((dx: number) => { setSidebar(sidebarBase.current + dx); }, [setSidebar]);
  const onDetailsDrag = useCallback((dx: number) => { setDetails(detailsBase.current - dx); }, [setDetails]);

  return (
    <div
      ref={frameRef}
      className={
        // h-dvh + overflow-hidden：外壳恒等于视口，三列各自滚动，页面本身不滚
        "relative grid h-dvh overflow-hidden bg-shell-bg-base transition-[grid-template-columns] duration-300 ease-[var(--ds-ease-in-out)]" +
        (dragging ? " transition-none" : "")
      }
      style={{ gridTemplateColumns }}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-details-collapsed={detailsColumnWidth === 0 || undefined}
      data-details-mode={detailsMode}
      data-details-fullscreen={detailsFullscreen || undefined}
      data-details-overlay={detailsOverlay || undefined}
      data-dragging={dragging || undefined}
    >
      {/* sidebar 槽位：折叠时以紧凑 rail 保持挂载；拖拽过渡由 frame 统一控制 */}
      <div className="material-sidebar min-w-0 overflow-hidden hairline-r border-shell-border">
        <Sidebar wide={!sidebarCollapsed} onExpand={() => toggleSidebar()} />
      </div>

      <CenterColumn>
        {hasDocument
          ? <Navbar isCollapsed={sidebarCollapsed} onResetWidth={() => toggleSidebar()} />
          : <SlimTopBar collapsed={sidebarCollapsed} onExpand={() => toggleSidebar()} />}
        <main className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </main>
      </CenterColumn>

      {/* 让步链放不下三栏（details 被压成 0）但用户期望打开时：浮层呈现 + 点击遮罩关闭。
          面板仍在同一 React 位置 → 不重挂载，流式状态与草稿都保留。 */}
      {detailsOverlay && (
        <div
          className="fixed inset-0 z-chrome bg-black/20 dark:bg-black/40"
          onClick={closeDetails}
          aria-hidden="true"
        />
      )}

      {/* 没有详情列插件时连列壳都不渲染：mode 切换器属于列壳，留着就是一块空白的控件条 */}
      {hasDetailsPanel && (
        <DetailsColumn overlay={detailsOverlay}>
          {/* 详情列内容由 UI 插件贡献（当前是 ui-ai-panel）；0 宽时仅视觉关闭、不卸载 */}
          <DetailsPanel />
        </DetailsColumn>
      )}

      {/* 折叠 rail 是固定宽：关闭时不渲染拖拽手柄。全屏时 details 不可拖（宽度铺满）。 */}
      {!sidebarCollapsed && (
        <DragHandle side="sidebar" left={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />
      )}
      {!detailsFullscreen && detailsColumnWidth > 0 && (
        <DragHandle side="details" left={viewport - detailsColumnWidth} onStart={onDetailsStart} onDrag={onDetailsDrag} onEnd={onDragEnd} />
      )}
    </div>
  );
}

export default AppShell;