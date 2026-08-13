import type { ReactNode } from "react";

export interface PanelTitleProps {
  title: string;
  action?: ReactNode;
}

export default function PanelTitle({ title, action }: PanelTitleProps) {
  return (
    <header className="flex h-18 shrink-0 items-center justify-between px-5">
      <h2 className="m-0 text-xl font-semibold tracking-[-0.3px] text-[var(--app-text)]">{title}</h2>
      {action}
    </header>
  );
}
