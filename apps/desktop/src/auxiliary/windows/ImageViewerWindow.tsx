import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Button, Spin, Tooltip } from "antd";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  Focus,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { ImageGalleryItem, ImageViewerTask } from "@chat/shared";

export interface ImageViewerWindowProps {
  task: ImageViewerTask;
}

type ViewMode = "fit" | "actual" | "manual";

export const clampImageScale = (value: number) =>
  Math.min(5, Math.max(0.1, value));

export default function ImageViewerWindow({ task }: ImageViewerWindowProps) {
  const bridge = window.auxiliary;
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const [items, setItems] = useState<ImageGalleryItem[]>([]);
  const [index, setIndex] = useState(0);
  const [previousCursor, setPreviousCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [historyComplete, setHistoryComplete] = useState(true);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [mode, setMode] = useState<ViewMode>("fit");
  const [manualScale, setManualScale] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const current = items[index];
  const scale = mode === "fit" ? fitScale : mode === "actual" ? 1 : manualScale;

  const resetTransform = useCallback(() => {
    setMode("fit");
    setManualScale(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setItems([]);
    resetTransform();
    void bridge?.images
      .getPage({
        taskId: task.taskId,
        direction: "initial",
        limit: 50,
      })
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setPreviousCursor(page.previousCursor);
        setNextCursor(page.nextCursor);
        setHistoryComplete(page.historyComplete);
        const targetKey = task.initialDraftId
          ? `draft:${task.initialDraftId}`
          : `attachment:${task.initialAttachmentId}`;
        const target = page.items.findIndex((item) => item.key === targetKey);
        setIndex(target >= 0 ? target : Math.max(0, page.items.length - 1));
        if (!page.items.length) setError("当前会话没有可查看的图片");
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message || "读取本地图片失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [bridge, resetTransform, task]);

  useEffect(() => {
    let active = true;
    setUrl("");
    setError("");
    resetTransform();
    if (!current) return;
    void bridge?.images
      .resolve({
        taskId: task.taskId,
        imageKey: current.key,
      })
      .then((result) => {
        if (active) setUrl(result.url);
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message || "图片加载失败");
      });
    return () => {
      active = false;
    };
  }, [bridge, current, reloadKey, resetTransform, task.taskId]);

  useEffect(() => {
    if (!bridge) return;
    for (const item of [items[index - 1], items[index + 1]].filter(Boolean)) {
      void bridge.images
        .resolve({
          taskId: task.taskId,
          imageKey: item.key,
        })
        .then(({ url: nextUrl }) => {
          const image = new Image();
          image.src = nextUrl;
        })
        .catch(() => undefined);
    }
  }, [bridge, index, items, task.taskId]);

  const calculateFit = useCallback(() => {
    const viewport = viewportRef.current;
    const image = imageRef.current;
    if (!viewport || !image?.naturalWidth || !image.naturalHeight) return;
    const rotated = Math.abs(rotation % 180) === 90;
    const width = rotated ? image.naturalHeight : image.naturalWidth;
    const height = rotated ? image.naturalWidth : image.naturalHeight;
    setFitScale(
      Math.min(
        1,
        Math.max(0.1, (viewport.clientWidth - 40) / width),
        Math.max(0.1, (viewport.clientHeight - 88) / height),
      ),
    );
  }, [rotation]);

  useEffect(() => {
    calculateFit();
    if (!viewportRef.current) return;
    const observer = new ResizeObserver(calculateFit);
    observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, [calculateFit, url]);

  const previous = useCallback(async () => {
    if (paging) return;
    if (index > 0) {
      setIndex((value) => value - 1);
      return;
    }
    if (!bridge || !previousCursor) return;
    setPaging(true);
    try {
      const page = await bridge.images.getPage({
        taskId: task.taskId,
        direction: "previous",
        cursor: previousCursor,
        limit: 50,
      });
      if (!page.items.length) return setPreviousCursor(null);
      setItems((currentItems) => [...page.items, ...currentItems]);
      setIndex(page.items.length - 1);
      setPreviousCursor(page.previousCursor);
    } finally {
      setPaging(false);
    }
  }, [bridge, index, paging, previousCursor, task.taskId]);

  const next = useCallback(async () => {
    if (paging) return;
    if (index < items.length - 1) {
      setIndex((value) => value + 1);
      return;
    }
    if (!bridge || !nextCursor) return;
    setPaging(true);
    try {
      const page = await bridge.images.getPage({
        taskId: task.taskId,
        direction: "next",
        cursor: nextCursor,
        limit: 50,
      });
      if (!page.items.length) return setNextCursor(null);
      const nextIndex = items.length;
      setItems((currentItems) => [...currentItems, ...page.items]);
      setIndex(nextIndex);
      setNextCursor(page.nextCursor);
    } finally {
      setPaging(false);
    }
  }, [bridge, index, items.length, nextCursor, paging, task.taskId]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") void previous();
      if (event.key === "ArrowRight") void next();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [next, previous]);

  function zoom(delta: number) {
    setMode("manual");
    setManualScale(clampImageScale(scale + delta));
    setOffset({ x: 0, y: 0 });
  }

  function pointerDown(event: ReactPointerEvent) {
    if (scale <= fitScale) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: offset.x,
      top: offset.y,
    };
  }

  function pointerMove(event: ReactPointerEvent) {
    if (!dragRef.current) return;
    setOffset({
      x: dragRef.current.left + event.clientX - dragRef.current.x,
      y: dragRef.current.top + event.clientY - dragRef.current.y,
    });
  }

  const tools = [
    [
      "上一张",
      <ArrowLeft size={18} />,
      index === 0 && !previousCursor,
      previous,
    ],
    [
      "下一张",
      <ArrowRight size={18} />,
      index >= items.length - 1 && !nextCursor,
      next,
    ],
    ["缩小", <ZoomOut size={18} />, scale <= 0.1, () => zoom(-0.25)],
    ["放大", <ZoomIn size={18} />, scale >= 5, () => zoom(0.25)],
    [
      mode === "actual" ? "适应窗口" : "原始尺寸",
      <Focus size={18} />,
      false,
      () => {
        setMode(mode === "actual" ? "fit" : "actual");
        setOffset({ x: 0, y: 0 });
      },
    ],
    [
      "顺时针旋转",
      <RotateCw size={18} />,
      false,
      () => {
        setRotation((value) => (value + 90) % 360);
        setOffset({ x: 0, y: 0 });
      },
    ],
    [
      "另存为",
      <Download size={18} />,
      !current,
      () =>
        current &&
        void bridge?.images.saveAs({
          taskId: task.taskId,
          imageKey: current.key,
        }),
    ],
  ] as const;

  return (
    <main className="fixed inset-0 overflow-hidden bg-[var(--app-canvas)] text-[var(--app-text)]">
      {!historyComplete && (
        <span className="absolute top-3 left-3 z-10 rounded-full bg-black/45 px-2.5 py-1 text-[10px] text-white">
          仅展示已同步到本地的图片
        </span>
      )}
      <div
        ref={viewportRef}
        className={`absolute inset-0 grid place-items-center overflow-hidden ${
          scale > fitScale ? "cursor-grab active:cursor-grabbing" : ""
        }`}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
      >
        {loading ? (
          <Spin />
        ) : error || !current ? (
          <div className="max-w-[360px] text-center">
            <p className="m-0 text-sm text-[var(--app-text-secondary)]">
              {error || "没有可查看的图片"}
            </p>
            {current && (
              <Button
                className="!mt-3"
                onClick={() => setReloadKey((value) => value + 1)}
              >
                重新加载
              </Button>
            )}
          </div>
        ) : url ? (
          <img
            ref={imageRef}
            src={url}
            alt={current.originalName}
            draggable={false}
            className="max-w-none select-none"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg) scale(${scale})`,
              transition: dragRef.current ? "none" : "transform 120ms ease",
            }}
            onLoad={calculateFit}
            onError={() => setError("图片加载失败")}
          />
        ) : (
          <Spin />
        )}
      </div>
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center rounded-xl border border-[var(--app-line)] bg-[color-mix(in_srgb,var(--app-surface)_95%,transparent)] p-1.5 shadow-[0_8px_24px_rgba(31,45,61,.14)]">
        {tools.map(([title, icon, disabled, action], toolIndex) => (
          <span key={title} className="flex items-center">
            {[2, 4, 6].includes(toolIndex) && (
              <i className="mx-1 h-5 w-px bg-[var(--app-line)]" />
            )}
            <Tooltip title={title}>
              <Button
                type="text"
                icon={icon}
                disabled={disabled}
                onClick={() => void action()}
                className="!grid !h-8 !w-8 !place-items-center !rounded-lg !px-0 !text-[var(--app-text-secondary)] hover:!bg-[var(--app-primary-soft)] hover:!text-[var(--app-primary)]"
              />
            </Tooltip>
          </span>
        ))}
      </div>
    </main>
  );
}
