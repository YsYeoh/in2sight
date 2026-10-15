'use client';

// A next/link that shows the xs orb while ITS navigation is pending (useLinkStatus must live inside the <Link>).
// With an icon the orb takes the icon's place; without one it sits just after the text. Both are absolutely positioned
// inside a fixed box, so nothing shifts; .link-pending / .link-pending-hide swap them only after 100 ms (fast navigations show nothing).
import type { ComponentProps, ReactNode } from 'react';
import Link, { useLinkStatus } from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { InsightOrb } from '@/components/shared/InsightOrb';
import { cn } from '@/lib/utils';

function Pending({ icon: Icon, iconClassName, children }: { icon?: LucideIcon; iconClassName?: string; children: ReactNode }) {
  const { pending } = useLinkStatus();
  const orb = <InsightOrb size="xs" decorative className="link-pending absolute inset-0 m-auto" />;
  if (!Icon)
    return (
      <span className="relative">
        {children}
        {pending ? (
          <span className="absolute top-1/2 left-full ml-1 size-4 -translate-y-1/2">
            {orb}
          </span>
        ) : null}
      </span>
    );
  return (
    <>
      <span className={cn('relative block shrink-0', iconClassName)}>
        <Icon aria-hidden className={cn('size-full', pending && 'link-pending-hide')} />
        {pending ? orb : null}
      </span>
      {children}
    </>
  );
}

export function NavLink({ icon, iconClassName, children, ...props }: ComponentProps<typeof Link> & { icon?: LucideIcon; iconClassName?: string }) {
  return (
    <Link {...props}>
      <Pending icon={icon} iconClassName={iconClassName}>
        {children}
      </Pending>
    </Link>
  );
}
