'use client';

// Sortable table on md+, card list on phones (CSS breakpoints only, both rendered; never matchMedia).
// ponytail: client-side sort of already-loaded rows; TanStack Table (SPEC §2) comes in with the part-2 Posts table
// when it needs pagination / column visibility.
import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortValue?: (row: T) => number | string | null; // sortable when set; nulls always sort last
  align?: 'left' | 'right';
}

type Sort = { key: string; dir: 'asc' | 'desc' } | null;

export function sortRows<T>(rows: T[], columns: Column<T>[], sort: Sort): T[] {
  const col = sort && columns.find((c) => c.key === sort.key);
  if (!sort || !col?.sortValue) return rows;
  const get = col.sortValue;
  const sign = sort.dir === 'asc' ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, v: get(row) }))
    .sort((a, b) => {
      if (a.v === null || b.v === null) return a.v === b.v ? a.i - b.i : a.v === null ? 1 : -1;
      if (a.v === b.v) return a.i - b.i; // stable
      return (typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v))) * sign;
    })
    .map((x) => x.row);
}

export function DataTable<T>({ rows, columns, rowKey, caption, empty, loading = false, initialSort = null }: { rows: T[]; columns: Column<T>[]; rowKey: (row: T) => string; caption: string; empty?: ReactNode; loading?: boolean; initialSort?: Sort }) {
  const t = useTranslations('table');
  const [sort, setSort] = useState<Sort>(initialSort);
  const sorted = sortRows(rows, columns, sort);
  const [first, ...rest] = columns;
  const toggle = (key: string) => setSort((s) => (s?.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));
  const sortable = columns.filter((c) => c.sortValue);

  if (!loading && rows.length === 0) return <div className="py-6 text-center text-sm text-muted-foreground">{empty ?? t('empty')}</div>;

  return (
    <div data-slot="data-table" className="min-w-0">
      <div className="hidden md:block">
        <Table>
          <caption className="sr-only">{caption}</caption>
          <TableHeader>
            <TableRow>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                const Icon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
                return (
                  <TableHead key={c.key} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined} className={cn(c.align === 'right' && 'text-right')}>
                    {c.sortValue ? (
                      <button type="button" onClick={() => toggle(c.key)} className={cn('inline-flex items-center gap-1 rounded-sm text-xs font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring', active ? 'text-foreground' : 'text-muted-foreground')}>
                        {c.header}
                        <Icon aria-hidden="true" className={cn('size-3', !active && 'opacity-50')} />
                      </button>
                    ) : (
                      <span className="text-xs font-medium text-muted-foreground">{c.header}</span>
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? [0, 1, 2].map((i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={columns.length}>
                      <Skeleton className="h-3.5 w-3/4" />
                    </TableCell>
                  </TableRow>
                ))
              : sorted.map((r) => (
                  <TableRow key={rowKey(r)}>
                    {columns.map((c) => (
                      <TableCell key={c.key} className={cn('max-w-64 truncate', c.align === 'right' && 'text-right tabular-nums')}>
                        {c.cell(r)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-[var(--gp)] md:hidden">
        {sortable.length > 0 ? (
          <label className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
            {t('sortBy')}
            <select
              className="h-[var(--ctl-sm)] rounded-md border border-input bg-background px-2 text-xs text-foreground"
              value={sort?.key ?? ''}
              onChange={(e) => setSort(e.target.value ? { key: e.target.value, dir: 'desc' } : null)}
            >
              <option value="">{t('defaultOrder')}</option>
              {sortable.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.header}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <ul className="grid gap-[var(--gp)]" aria-label={caption}>
          {loading
            ? [0, 1, 2].map((i) => (
                <li key={i} className="rounded-lg border bg-card p-[var(--pc)]">
                  <Skeleton className="h-3.5 w-2/3" />
                </li>
              ))
            : sorted.map((r) => (
                <li key={rowKey(r)} className="min-w-0 rounded-lg border bg-card p-[var(--pc)]">
                  <div className="min-w-0 truncate font-medium">{first.cell(r)}</div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                    {rest.map((c) => (
                      <div key={c.key} className="min-w-0">
                        <dt className="truncate text-muted-foreground">{c.header}</dt>
                        <dd className="truncate font-medium tabular-nums">{c.cell(r)}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
        </ul>
      </div>
    </div>
  );
}
