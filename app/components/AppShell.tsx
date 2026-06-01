import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="cia-app-shell">
      <main className="cia-main">{children}</main>
    </div>
  );
}
