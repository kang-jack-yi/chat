import {
  Component,
  lazy,
  StrictMode,
  Suspense,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Spin } from "antd";
import type { AuxiliaryTask } from "@chat/shared";
import "antd/dist/reset.css";
import "../renderer/styles/tailwind.css";
import "../renderer/styles/global.less";
import AppThemeProvider from "../renderer/providers/AppThemeProvider";
import PreferencesRuntime from "../renderer/providers/PreferencesRuntime";

const InviteHistoryWindow = lazy(() => import("./windows/InviteHistoryWindow"));
const ImageViewerWindow = lazy(() => import("./windows/ImageViewerWindow"));
const ChatHistoryWindow = lazy(() => import("./windows/ChatHistoryWindow"));
const ForwardRecordWindow = lazy(() => import("./windows/ForwardRecordWindow"));

class AuxiliaryErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Auxiliary window render failed", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid h-screen place-items-center bg-[var(--app-canvas)] p-8">
        <div className="w-full max-w-[440px] rounded-2xl border border-[var(--app-line)] bg-[var(--app-surface)] p-6 text-center shadow-sm">
          <h1 className="m-0 text-base font-semibold text-[var(--app-text)]">窗口加载失败</h1>
          <p className="mt-2 break-all text-xs leading-5 text-[var(--app-text-secondary)]">
            {this.state.error.message || "辅助窗口发生未知错误"}
          </p>
          <button
            type="button"
            className="mt-4 rounded-lg bg-[var(--app-primary)] px-5 py-2 text-sm text-white hover:bg-[var(--app-primary-hover)]"
            onClick={() => window.location.reload()}
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }
}

function AuxiliaryShell() {
  const [task, setTask] = useState<AuxiliaryTask | null>(null);

  useEffect(() => {
    const bridge = window.auxiliary;
    if (!bridge) return;
    const loadTask = () => {
      void bridge.task.get().then(setTask);
    };
    const removeReady = bridge.task.onReady(loadTask);
    const removeUpdated = bridge.task.onUpdated(loadTask);
    const removeReset = bridge.task.onReset((taskId) => {
      flushSync(() => {
        setTask(null);
      });
      void bridge.task.resetComplete(taskId);
    });
    loadTask();
    return () => {
      removeReady();
      removeUpdated();
      removeReset();
    };
  }, []);

  if (!task) {
    return (
      <div className="grid h-screen place-items-center bg-[var(--app-canvas)]">
        <Spin size="small" />
      </div>
    );
  }
  return (
    <Suspense
      fallback={(
        <div className="grid h-screen place-items-center bg-[var(--app-canvas)]">
          <Spin />
        </div>
      )}
    >
      {task.type === "invite-history" ? (
        <InviteHistoryWindow key={task.taskId} task={task} />
      ) : task.type === "chat-history" ? (
        <ChatHistoryWindow key={task.taskId} task={task} />
      ) : task.type === "forward-record" ? (
        <ForwardRecordWindow key={task.taskId} task={task} />
      ) : (
        <ImageViewerWindow key={task.taskId} task={task} />
      )}
    </Suspense>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PreferencesRuntime>
      <AppThemeProvider>
        <AuxiliaryErrorBoundary>
          <AuxiliaryShell />
        </AuxiliaryErrorBoundary>
      </AppThemeProvider>
    </PreferencesRuntime>
  </StrictMode>,
);
