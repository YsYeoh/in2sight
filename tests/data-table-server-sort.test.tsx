import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import { DataTable, type Column, type ServerSort } from '@/components/shared/DataTable';

type Row = { id: string; reach: number; likes: number };
const ROWS: Row[] = [
  { id: 'b', reach: 5, likes: 9 },
  { id: 'a', reach: 50, likes: 1 },
];
const columns: Column<Row>[] = [
  { key: 'post', header: 'Post', cell: (r) => r.id },
  { key: 'reach', header: 'Reach', cell: (r) => r.reach, align: 'right' },
  { key: 'likes', header: 'Likes', cell: (r) => r.likes, sortValue: (r) => r.likes }, // client-sortable, but not on the server
];
const server: ServerSort = { current: { key: 'reach', dir: 'asc' }, href: (key) => (key === 'likes' ? null : `?sort=${key}`) };
const wrap = (serverSort?: ServerSort) =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <DataTable rows={ROWS} columns={columns} rowKey={(r) => r.id} caption="Posts" pageSize={1} serverSort={serverSort} />
    </NextIntlClientProvider>,
  );

describe('DataTable: server sort', () => {
  it('rows stay in the server order, all of them (no client sort, no "Show more", no phone sort select)', () => {
    wrap(server);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['b', 'a']);
    expect(screen.queryByRole('button', { name: en.table.showMore })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('headers with a server sort are links; the active one carries aria-sort; others are plain text', () => {
    wrap(server);
    const heads = within(screen.getByRole('table')).getAllByRole('columnheader');
    expect(within(heads[0]).getByRole('link', { name: 'Post' })).toHaveAttribute('href', '?sort=post');
    expect(within(heads[1]).getByRole('link', { name: 'Reach' })).toHaveAttribute('href', '?sort=reach');
    expect(heads[1]).toHaveAttribute('aria-sort', 'ascending');
    expect(heads[0]).not.toHaveAttribute('aria-sort');
    expect(within(heads[2]).queryByRole('link')).toBeNull();
    expect(within(heads[2]).queryByRole('button')).toBeNull();
  });

  it('without serverSort nothing changes: client sort buttons and "Show more"', () => {
    wrap();
    expect(within(screen.getByRole('table')).getByRole('button', { name: 'Likes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.table.showMore })).toBeInTheDocument();
  });
});
