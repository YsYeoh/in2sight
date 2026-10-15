import type { ComponentProps } from 'react';
import { InsightOrb } from '@/components/shared/InsightOrb';
import { Button } from '@/components/ui/button';

/** A Button that is disabled and aria-busy while `pending`, with the xs orb before its label. Not for `asChild`. */
export function LoadingButton({ pending = false, disabled, children, ...props }: ComponentProps<typeof Button> & { pending?: boolean }) {
  return (
    <Button disabled={disabled || pending} aria-busy={pending || undefined} {...props}>
      {pending ? <InsightOrb size="xs" decorative /> : null}
      {children}
    </Button>
  );
}
