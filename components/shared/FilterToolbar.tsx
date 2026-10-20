'use client';

// The filter toolbar pattern (docs/UI_STANDARDS.md): one row of equal-height controls, an optional Advanced panel,
// removable chips for every active filter and a "Clear all". Every choice is a URL change (a link, or
// router.push/replace with the top progress bar), so links, saved views and Back keep working.
import { ChevronDown, Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { startProgress } from '@/components/shared/NavigationProgress';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/shared/ResponsiveDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export const SEARCH_DEBOUNCE_MS = 400;

export interface FilterChip {
  id: string;
  label: string;
  href: string; // the URL with that one filter removed
}

export interface FilterOption {
  value: string;
  label: string;
}

export function useApply(): (href: string, o?: { replace?: boolean }) => void {
  const router = useRouter();
  return useCallback(
    (href, o) => {
      startProgress(href);
      if (o?.replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [router],
  );
}

export function FilterToolbar({
  label,
  children,
  advanced,
  advancedCount,
  end,
  chips = [],
  clearHref,
}: {
  label: string;
  children: ReactNode;
  advanced?: ReactNode;
  advancedCount?: number;
  end?: ReactNode;
  chips?: FilterChip[];
  clearHref?: string;
}) {
  const t = useTranslations('filters');
  return (
    <div role="group" aria-label={label} className="mb-[var(--gp)] grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {advanced ? (
          <FilterPanel label={t('advanced')} title={t('advancedTitle')} active={!!advancedCount} badge={advancedCount}>
            {advanced}
          </FilterPanel>
        ) : null}
        {end ? <div className="ms-auto flex flex-wrap items-center gap-2">{end}</div> : null}
      </div>
      {chips.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <ul aria-label={t('active')} className="flex flex-wrap items-center gap-2">
            {chips.map((c) => (
              <li key={c.id}>
                <Link
                  href={c.href}
                  scroll={false}
                  aria-label={t('remove', { name: c.label })}
                  className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-xs hover:bg-accent"
                >
                  {c.label}
                  <X className="size-3" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
          {clearHref ? (
            <Link href={clearHref} scroll={false} className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
              {t('clearAll')}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function FilterPanel({
  label,
  title,
  description,
  active,
  badge,
  open,
  onOpenChange,
  children,
}: {
  label: string;
  title: string;
  description?: string;
  active?: boolean;
  badge?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const t = useTranslations('filters');
  const count = badge ?? 0;
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogTrigger asChild>
        <Button type="button" variant={active ? 'secondary' : 'outline'} aria-label={count > 0 ? t('withCount', { label, count }) : undefined}>
          <span className="truncate">{label}</span>
          {count > 0 ? (
            <Badge aria-hidden="true" variant="secondary">
              {count}
            </Badge>
          ) : null}
          <ChevronDown aria-hidden />
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md" {...(description ? {} : { 'aria-describedby': undefined })}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          {description ? <ResponsiveDialogDescription>{description}</ResponsiveDialogDescription> : null}
        </ResponsiveDialogHeader>
        <div className="grid gap-[var(--gp)]">{children}</div>
        <ResponsiveDialogFooter>
          <ResponsiveDialogClose asChild>
            <Button type="button" variant="outline">
              {t('done')}
            </Button>
          </ResponsiveDialogClose>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

// Only inside a FilterPanel (it needs the dialog context): picking an option closes the panel.
export function FilterOptions({ label, options }: { label: string; options: { href: string; label: string; current?: boolean }[] }) {
  return (
    <nav aria-label={label} className="grid gap-1.5">
      <p aria-hidden="true" className="text-xs font-medium text-muted-foreground">
        {label}
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <li key={o.href}>
            <ResponsiveDialogClose asChild>
              <Button asChild size="sm" variant={o.current ? 'secondary' : 'ghost'}>
                <Link href={o.href} scroll={false} aria-current={o.current ? 'true' : undefined}>
                  {o.label}
                </Link>
              </Button>
            </ResponsiveDialogClose>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function FilterSelect({
  id,
  label,
  value,
  options,
  hrefFor,
}: {
  id: string;
  label: string;
  value: string;
  options: FilterOption[];
  hrefFor: (value: string) => string;
}) {
  const apply = useApply();
  return (
    <>
      <label htmlFor={id} className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => apply(hrefFor(e.target.value))}
        className="h-[var(--ctl)] max-w-56 min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </>
  );
}

export function FilterSearch({
  id,
  label,
  value,
  placeholder,
  hrefFor,
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  hrefFor: (text: string) => string;
}) {
  const apply = useApply();
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value); // the last `value` rendered
  const [sent, setSent] = useState(value); // the last text this box applied
  if (value !== seen) {
    // the URL changed: follow it, unless it is this box's own text arriving (then keep what is being typed)
    setSeen(value);
    if (value !== sent) {
      setText(value);
      setSent(value);
    }
  }
  const send = useCallback(
    (q: string) => {
      setSent(q);
      apply(hrefFor(q), { replace: true });
    },
    [apply, hrefFor],
  );
  useEffect(() => {
    const q = text.trim();
    if (q === value.trim() || q === sent) return; // nothing new: an outside change or Enter cancels the pause
    const timer = setTimeout(() => send(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, value, sent, send]);
  // ponytail: a parent re-render with a new hrefFor restarts the pause; harmless while parents re-render only on navigation
  return (
    <form
      role="search"
      className="relative"
      onSubmit={(e) => {
        e.preventDefault();
        const q = text.trim();
        if (q !== value.trim() && q !== sent) send(q);
      }}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input id={id} type="search" value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} className="w-56 max-w-full pl-8" />
    </form>
  );
}
