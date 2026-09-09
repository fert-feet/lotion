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
import { useLayout } from "@/hooks/use-layout";
import Sidebar from "./sidebar/sidebar";
import Navbar from "./navbar";
import { LazyAiPanel } from "./lazy-panels";

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

/** 详情列 grid item；宽度 0 时保持子树挂载（关闭不卸载）。 */
function DetailsColumn(props: { children?: ReactNode }) {
  return <div className="min-w-0 overflow-hidden">{props.children}</div>;
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
          ? "after:absolute after:top-1/2 after:left-1/2 after:-translate-x-1/2 after:-translate-y-1/2 after:block after:h-8 after:w-3 after:rounded-[10px] after:border after:border-shell-border-l2 after:bg-shell-bg-base after:opacity-0 after:transition-opacity after:duration-300 after:ease-[var(--ds-ease-in-out)] " +
            "hover:after:opacity-100 [&[data-dragging]]:after:opacity-100 [&[data-dragging]]:after:bg-shell-row-active"
          : "")
      }
      style={{ left: props.left }}
      data-side={props.side}
      data-dragging={dragging || undefined}
    />
  );
}

/** 非文档页顶栏：折叠时提供展开按钮。 */
function SlimTopBar(props: { collapsed: boolean; onExpand: () => void }) {
  return (
    <nav className="flex h-12 shrink-0 items-center bg-background px-3">
      {props.collapsed && (
        <button
          type="button"
          onClick={props.onExpand}
          aria-label="展开侧边栏"
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-shell-label-secondary hover:bg-shell-row-hover"
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
        "relative grid h-full overflow-hidden bg-shell-bg-base transition-[grid-template-columns] duration-300 ease-[var(--ds-ease-in-out)]" +
        (dragging ? " transition-none" : "")
      }
      style={{ gridTemplateColumns: [cols.sidebar + "px", "minmax(0, 1fr)", cols.details + "px"].join(" ") }}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-details-collapsed={cols.details === 0 || undefined}
      data-dragging={dragging || undefined}
    >
      {/* sidebar 槽位：折叠时以紧凑 rail 保持挂载；拖拽过渡由 frame 统一控制 */}
      <div className="min-w-0 overflow-hidden border-r border-shell-border bg-shell-sidebar">
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

      <DetailsColumn>
        {/* 详情列（AI 面板）常驻挂载；0 宽时仅视觉关闭 */}
        <LazyAiPanel />
      </DetailsColumn>

      {/* 折叠 rail 是固定宽：关闭时不渲染拖拽手柄。 */}
      {!sidebarCollapsed && (
        <DragHandle side="sidebar" left={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />
      )}
      {cols.details > 0 && (
        <DragHandle side="details" left={viewport - cols.details} onStart={onDetailsStart} onDrag={onDetailsDrag} onEnd={onDragEnd} />
      )}
    </div>
  );
}

export default AppShell;