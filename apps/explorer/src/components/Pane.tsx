import type { ReactNode } from "react";

interface PaneProps {
  label: string;
  toolbar?: ReactNode;
  children: ReactNode;
  className?: string;
}

export default function Pane({ label, toolbar, children, className = "" }: PaneProps) {
  return (
    <section
      className={
        "flex flex-col min-h-0 min-w-0 bg-surface-light dark:bg-surface-dark border-hair border-line-light dark:border-line-dark " +
        className
      }
    >
      <header className="flex items-center justify-between px-3 py-2 border-b-hair border-line-light dark:border-line-dark">
        <span className="pane-label">{label}</span>
        <div className="flex items-center gap-1.5">{toolbar}</div>
      </header>
      <div className="flex-1 min-h-0 min-w-0 overflow-auto">{children}</div>
    </section>
  );
}
