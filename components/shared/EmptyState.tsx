import type { ReactNode } from 'react';

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div role="status" className="flex flex-col items-center gap-1.5 px-4 py-10 text-center">
      {icon ? <div className="mb-1 grid size-10 place-items-center rounded-full bg-accent text-accent-foreground">{icon}</div> : null}
      <p className="font-medium">{title}</p>
      {description ? <p className="max-w-sm text-xs text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
