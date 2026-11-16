"use client";

// 三栏 shell（移植自 DSH packages/client/ui-layout/src/client/AppFrame.tsx 设计）：
// grid 轨道（sidebar | center | details）、拖拽手柄（pointer capture + rAF 节流）、
// 让步链（columns.ts）、窄屏自动折叠。sidebar 槽位按让步结果渲染（折叠时是 56px rail，
// 保持挂载）；details 槽位保持挂载，0 宽时仅视觉关闭；窗口放不下三栏时降级为右侧浮层
// （不是可选模式，而是让步链触发的兜底）。
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useParams } from "react-router";
import { MenuIcon } from "@/components/icons";
import {
  computeColumns,
  DETAILS_DEFAULT,
  DETAILS_MAX,
  DETAILS_MIN,
  SIDEBAR_AUTO_COLLAPSE,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
} from "@/lib/layout/columns";
import { useLayout } from "@/hooks/use-layout";
import Sidebar from "./sidebar/sidebar";
import Navbar from "./navbar";
import { useHasSlot, useSlot } from "@/src/kernel/react";
import { SLOT_DETAILS_PANEL } from "./ui-plugins";
import { useDialogFocus } from "@/components/ui/_focus";

/** 中心列 grid item（会话主体构建块）。
 *  relative + @container：编辑器大纲面板的定位基准（绝对定位）与可见性基准（容器查询按列宽，
 *  而非视口宽度）——否则打开 AI 面板后大纲会浮在 AI 面板之上。 */
function CenterColumn(props: { children?: ReactNode; inert?: boolean }) {
  // bg-background（纸张底）保持编辑器观感；shell 底色只用于侧边栏/详情栏
  return (
    <div
      style={{ gridColumn: 2 }}
      aria-hidden={props.inert || undefined}
      inert={props.inert || undefined}
      className="@container relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-background"
    >
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
function DetailsColumn(props: {
  children?: ReactNode;
  overlay?: boolean;
  inactive?: boolean;
  onClose: () => void;
}) {
  const { overlay = false, inactive = false, onClose } = props;
  const panelRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(overlay && !inactive, panelRef);

  useEffect(() => {
    if (!overlay || inactive) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [inactive, overlay, onClose]);

  return (
    <div
      ref={panelRef}
      id="details-panel"
      style={{ gridColumn: 3 }}
      data-details-column
      data-details-overlay={props.overlay || undefined}
      role={props.overlay ? "dialog" : undefined}
      aria-modal={props.overlay ? "true" : undefined}
      aria-label={props.overlay ? "AI 文档助手" : undefined}
      aria-hidden={inactive || undefined}
      inert={inactive || undefined}
      tabIndex={props.overlay ? -1 : undefined}
      className={
        props.overlay
          ? "details-overlay-safe material-sidebar fixed inset-y-0 right-0 z-chrome w-[min(440px,100vw)] min-w-0 overflow-hidden hairline-l border-shell-border shadow-elevation-3"
          : "material-sidebar min-w-0 overflow-hidden hairline-l border-shell-border"
      }
    >
      <div className="flex h-full min-w-0 flex-col">
        <div className="min-h-0 flex-1">{props.children}</div>
      </div>
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
  value: number;
  min: number;
  max: number;
  onStep: (delta: number) => void;
  onReset: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const { onStep, onReset } = props;
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

  const onPointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    setDragging(false);
    callbacks.current.onEnd();
  }, []);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      onStep(event.key === "ArrowRight" ? 8 : -8);
    } else if (event.key === "Home") {
      event.preventDefault();
      onReset();
    }
  }, [onStep, onReset]);

  const isDetails = props.side === "details";
  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={props.onReset}
      onKeyDown={onKeyDown}
      role="separator"
      tabIndex={0}
      aria-label={isDetails ? "调整 AI 面板宽度" : "调整侧边栏宽度"}
      aria-orientation="vertical"
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      aria-valuenow={Math.round(props.value)}
      title="拖拽或使用方向键调整宽度；Home 恢复默认"
      className={
        "absolute top-0 bottom-0 z-chrome -ml-1 w-2 cursor-col-resize touch-none outline-none focus-visible:bg-shell-row-active focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-shell-accent " +
        (dragging ? "transition-none " : "transition-[left] duration-300 ease-[var(--ds-ease-in-out)] ") +
        "after:absolute after:top-1/2 after:left-1/2 after:-translate-x-1/2 after:-translate-y-1/2 after:block after:h-8 after:w-3 after:rounded-card after:border after:border-shell-border-l2 after:bg-shell-bg-base after:opacity-0 after:transition-opacity after:duration-200 after:ease-[var(--ds-ease-out)] " +
        "hover:after:opacity-100 focus-visible:after:opacity-100 [&[data-dragging]]:after:opacity-100 [&[data-dragging]]:after:bg-shell-row-active"
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
  const location = useLocation();
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
  const sidebarColumnRef = useRef<HTMLDivElement | null>(null);
  // SSR 水合安全：首渲用固定宽（与服务端一致），挂载后 ResizeObserver 立即校正真实宽度
  const [viewport, setViewport] = useState(1440);
  const [sidebarClosing, setSidebarClosing] = useState(false);
  const [drawerRenderedOpen, setDrawerRenderedOpen] = useState(false);
  const drawerWasOpen = useRef(false);

  // 窄屏自动折叠：折叠在 shell 层决定，求解器保持无断点。
  const autoNarrow = viewport < SIDEBAR_AUTO_COLLAPSE;
  useEffect(() => { setNarrow(autoNarrow); }, [autoNarrow, setNarrow]);
  const sidebarCollapsed = narrow ? !narrowExpanded : sidebar === 0;
  const sidebarOverlay = narrow && narrowExpanded;
  const sidebarDrawerVisible = narrow && (sidebarOverlay || sidebarClosing);
  const sidebarWide = narrow
    ? sidebarClosing || (sidebarOverlay && drawerRenderedOpen)
    : !sidebarCollapsed;
  const sidebarPreference = narrow
    ? 0
    : sidebarCollapsed
      ? 0
      : sidebar === 0
        ? SIDEBAR_DEFAULT
        : sidebar;
  // 抽屉浮在内容上方；底层仍保留 56px rail 轨道，正文不会因打开抽屉而横向跳动。
  const cols = computeColumns(
    viewport,
    sidebarPreference,
    details === 0 ? 0 : details,
  );
  const colsRef = useRef(cols);
  colsRef.current = cols;
  const sidebarColumnWidth = cols.sidebar;
  // 详情列是否存在由插件决定：ui-ai-panel 被用户在设置里禁用时槽位无贡献者，
  // 此时"打开"不成立——否则详情列会作为一块空白壳挂在右边（入口能点、打开没内容）。
  const hasDetailsPanel = useHasSlot(SLOT_DETAILS_PANEL);
  const detailsOpen = hasDetailsPanel && details > 0;
  /** 浮层：只有让步链把 details 压成 0（窗口放不下三栏）时才发生，不再是一个可切换的模式 */
  const detailsOverlay = detailsOpen && cols.details === 0;
  /** details 作为真实网格列时的宽度（浮层时占 0 列，但仍挂载） */
  const detailsColumnWidth = detailsOverlay ? 0 : cols.details;
  const gridTemplateColumns = [sidebarColumnWidth + "px", "minmax(0, 1fr)", detailsColumnWidth + "px"].join(" ");

  // 关闭抽屉时先保留同一个 Sidebar 实例完成退场，再回落成 rail。
  useEffect(() => {
    if (sidebarOverlay) {
      drawerWasOpen.current = true;
      setSidebarClosing(false);
      return;
    }
    if (!drawerWasOpen.current) {
      setSidebarClosing(false);
      return;
    }
    drawerWasOpen.current = false;
    if (!narrow) {
      setSidebarClosing(false);
      return;
    }
    setSidebarClosing(true);
    const timer = window.setTimeout(() => setSidebarClosing(false), 220);
    return () => window.clearTimeout(timer);
  }, [narrow, sidebarOverlay]);

  // 从 -100% 起步，下一帧再进入 0，保证同一个固定侧栏也能播放开场。
  useEffect(() => {
    if (!sidebarOverlay) {
      setDrawerRenderedOpen(false);
      return;
    }
    const frame = requestAnimationFrame(() => setDrawerRenderedOpen(true));
    return () => cancelAnimationFrame(frame);
  }, [sidebarOverlay]);

  // 同一 Sidebar 兼任普通侧栏与抽屉：只在抽屉阶段提升到 Top Layer。
  useEffect(() => {
    if (!sidebarDrawerVisible) return;
    const node = sidebarColumnRef.current;
    if (!node || typeof node.showPopover !== "function") return;
    if (!node.matches(":popover-open")) node.showPopover();
    return () => {
      if (node.isConnected && node.matches(":popover-open")) node.hidePopover();
    };
  }, [sidebarDrawerVisible]);

  // 选择文档或切换页面后收起窄屏抽屉；打开抽屉本身不改变 pathname，因此不会被立即关闭。
  const pathnameRef = useRef(location.pathname);
  useEffect(() => {
    if (pathnameRef.current === location.pathname) return;
    pathnameRef.current = location.pathname;
    if (narrowExpanded) toggleSidebar();
  }, [location.pathname, narrowExpanded, toggleSidebar]);

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
  useEffect(() => {
    // 没有详情列插件时快捷键不接管：⌘J 不应"打开一列空的"
    if (!hasDetailsPanel) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        toggleDetails();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleDetails, hasDetailsPanel]);

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
        "relative grid h-dvh overflow-hidden bg-shell-bg-base transition-[grid-template-columns] duration-300 ease-[var(--ds-ease-in-out)] motion-reduce:transition-none" +
        (dragging ? " transition-none" : "")
      }
      style={{ gridTemplateColumns }}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-sidebar-overlay={sidebarOverlay || undefined}
      data-details-collapsed={detailsColumnWidth === 0 || undefined}
      data-details-overlay={detailsOverlay || undefined}
      data-dragging={dragging || undefined}
    >
      {/* sidebar 槽位始终是同一个 Sidebar 实例；窄屏打开时同一节点变成 fixed 抽屉。 */}
      <div
        ref={sidebarColumnRef}
        {...(sidebarDrawerVisible
          ? ({ popover: "manual" } as React.HTMLAttributes<HTMLDivElement>)
          : {})}
        style={{ gridColumn: 1 }}
        data-sidebar-column
        data-sidebar-drawer={sidebarDrawerVisible || undefined}
        data-sidebar-drawer-open={sidebarDrawerVisible && drawerRenderedOpen ? true : undefined}
        aria-hidden={(detailsOverlay && !sidebarDrawerVisible) || undefined}
        inert={(detailsOverlay && !sidebarDrawerVisible) || undefined}
        className={
          "material-sidebar min-w-0 overflow-hidden hairline-r border-shell-border " +
          (sidebarDrawerVisible
            ? "sidebar-drawer-safe fixed inset-y-0 left-0 z-drawer m-0 max-h-none max-w-none w-[min(320px,90vw)] p-0 shadow-elevation-3 transition-transform duration-200 ease-[var(--ds-ease-out)] motion-reduce:translate-x-0 motion-reduce:transition-none "
            : "relative ") +
          (sidebarDrawerVisible
            ? drawerRenderedOpen
              ? "translate-x-0"
              : "-translate-x-full"
            : "")
        }
      >
        <Sidebar
          wide={sidebarWide}
          overlay={sidebarDrawerVisible}
          drawerActive={sidebarOverlay}
          onExpand={toggleSidebar}
        />
      </div>

      <CenterColumn inert={sidebarOverlay || detailsOverlay}>
        {hasDocument
          ? <Navbar isCollapsed={sidebarCollapsed} onResetWidth={() => toggleSidebar()} />
          : <SlimTopBar collapsed={sidebarCollapsed} onExpand={() => toggleSidebar()} />}
        <main id="main-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
          {children}
        </main>
      </CenterColumn>

      {/* 让步链放不下三栏（details 被压成 0）但用户期望打开时：浮层呈现 + 点击遮罩关闭。
          面板仍在同一 React 位置 → 不重挂载，流式状态与草稿都保留。 */}
      {detailsOverlay && (
        <div
          data-details-scrim
          className="fixed inset-0 z-chrome bg-black/20 dark:bg-black/40"
          onClick={closeDetails}
          aria-hidden="true"
        />
      )}

      {/* 没有详情列插件时连列壳都不渲染：否则右侧会挂一块空白壳 */}
      {hasDetailsPanel && (
        <DetailsColumn
          overlay={detailsOverlay}
          inactive={!detailsOpen || sidebarOverlay}
          onClose={closeDetails}
        >
          {/* 详情列内容由 UI 插件贡献（当前是 ui-ai-panel）；0 宽时仅视觉关闭、不卸载 */}
          <DetailsPanel />
        </DetailsColumn>
      )}

      {/* 抽屉遮罩与抽屉使用同一个显隐阶段，关闭时一起退场。 */}
      {sidebarDrawerVisible && (
        <div
          data-sidebar-scrim
          className={
            "fixed inset-0 z-chrome bg-black/20 transition-opacity duration-200 dark:bg-black/40 " +
            (drawerRenderedOpen ? "opacity-100" : "pointer-events-none opacity-0")
          }
          onClick={() => toggleSidebar()}
          aria-hidden="true"
        />
      )}

      {/* 折叠 rail 是固定宽：关闭时不渲染拖拽手柄 */}
      {!narrow && !sidebarCollapsed && (
        <DragHandle
          side="sidebar"
          left={cols.sidebar}
          onStart={onSidebarStart}
          onDrag={onSidebarDrag}
          onEnd={onDragEnd}
          value={cols.sidebar}
          min={SIDEBAR_MIN}
          max={SIDEBAR_MAX}
          onStep={(delta) => setSidebar(colsRef.current.sidebar + delta)}
          onReset={() => setSidebar(SIDEBAR_DEFAULT)}
        />
      )}
      {detailsColumnWidth > 0 && (
        <DragHandle
          side="details"
          left={viewport - detailsColumnWidth}
          onStart={onDetailsStart}
          onDrag={onDetailsDrag}
          onEnd={onDragEnd}
          value={detailsColumnWidth}
          min={DETAILS_MIN}
          max={DETAILS_MAX}
          onStep={(delta) => setDetails(colsRef.current.details - delta)}
          onReset={() => setDetails(DETAILS_DEFAULT)}
        />
      )}
    </div>
  );
}

export default AppShell;
