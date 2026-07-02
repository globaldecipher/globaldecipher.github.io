import type { ReactNode } from "react";

interface PaneProps {
  id?: string;
  label: string;
  toolbar?: ReactNode;
  children: ReactNode;
  className?: string;
}

export default function Pane({ id, label, toolbar, children, className = "" }: PaneProps) {
  return (
    <section
      id={id}
      className={
        "flex flex-col min-h-0 min-w-0 bg-page-light dark:bg-page-dark border border-line-light dark:border-line-dark rounded-editorial " +
        className
      }
    >
      <header className="pane-header">
        <span className="pane-label shrink-0">{label}</span>
        <div className="pane-toolbar">{toolbar}</div>
      </header>
      <div className="flex-1 min-h-0 min-w-0 overflow-auto">{children}</div>
    </section>
  );
}
