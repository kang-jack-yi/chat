import { Empty } from "antd";
import type { ReactNode } from "react";

export interface EmptyStateProps {
  icon: ReactNode;
  title?: string;
  text?: string;
  compact?: boolean;
}

export default function EmptyState({ icon, title, text, compact }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center text-[var(--app-text-tertiary)] ${compact ? "px-2 py-20" : "h-full bg-[var(--app-surface)]"}`}>
      <Empty
        image={<div className={compact ? "text-slate-500" : "mx-auto grid size-16 place-items-center rounded-2xl bg-[var(--app-primary-soft)] text-[var(--app-primary)] shadow-[inset_0_0_0_1px_rgba(22,119,255,.06)]"}>{icon}</div>}
        description={
          <div>
            {title && <h2 className="mt-3 mb-1 text-base font-semibold text-[var(--app-text)]">{title}</h2>}
            {text && <p className="m-0 text-xs text-[var(--app-text-tertiary)]">{text}</p>}
          </div>
        }
      />
    </div>
  );
}
