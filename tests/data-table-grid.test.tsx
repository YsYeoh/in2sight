import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import { DataTable, type Column } from '@/components/shared/DataTable';

type Row = { id: string; name: string; reach: number };
const ROWS: Row[] = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, name: `Post ${i}`, reach: i * 10 }));
const COLUMNS: Column<Row>[] = [
  { key: 'name', header: 'Name', cell: (r) => r.name, sortValue: (r) => r.name },
  { key: 'reach', header: 'Reach', cell: (r) => String(r.reach), sortValue: (r) => r.reach, align: 'right' },
];
const tile = (r: Row) => <span data-testid="tile">{r.name}</span>;

function table(view?: 'table' | 'grid' | 'auto', withTile = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <DataTable rows={ROWS} columns={COLUMNS} rowKey={(r) => r.id} caption="Posts" initialSort={{ key: 'reach', dir: 'desc' }} pageSize={3} tile={withTile ? tile : undefined} view={view} />
    </NextIntlClientProvider>,
  );
}

describe('DataTable grid mode', () => {
  it('grid: tiles at every width, no table; sorted like the table and paged by "Show more"', async () => {
    const user = userEvent.setup();
    const { container } = table('grid');
    expect(screen.queryByRole('table')).toBeNull();
    const list = screen.getByRole('list', { name: 'Posts' });
    expect(list.parentElement).not.toHaveClass('md:hidden'); // visible from md too
    expect(within(list).getAllByTestId('tile').map((t) => t.textContent)).toEqual(['Post 6', 'Post 5', 'Post 4']);
    await user.selectOptions(screen.getByRole('combobox', { name: en.table.sortBy }), 'name');
    await user.click(screen.getByRole('button', { name: en.table.ascending }));
    expect(within(list).getAllByTestId('tile').map((t) => t.textContent)).toEqual(['Post 0', 'Post 1', 'Post 2']);
    await user.click(screen.getByRole('button', { name: en.table.showMore }));
    expect(within(list).getAllByTestId('tile')).toHaveLength(6);
    expect(container.querySelectorAll('li.rounded-lg')).toHaveLength(0); // no phone cards
  });

  it('auto: tiles below md, the table from md (CSS only: both rendered, one "Show more")', async () => {
    const user = userEvent.setup();
    table('auto');
    const list = screen.getByRole('list', { name: 'Posts' });
    expect(list.parentElement).toHaveClass('md:hidden');
    expect(screen.getByRole('table').parentElement?.parentElement).toHaveClass('hidden', 'md:block');
    expect(within(list).getAllByTestId('tile')).toHaveLength(3);
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(4); // header + 3
    await user.click(screen.getByRole('button', { name: en.table.showMore }));
    expect(within(list).getAllByTestId('tile')).toHaveLength(6);
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(7);
  });

  it('table (the default) or no tile: unchanged — table + phone cards, no tiles', () => {
    for (const [view, withTile] of [['table', true], [undefined, true], ['grid', false]] as const) {
      const { unmount } = table(view, withTile);
      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.queryAllByTestId('tile')).toHaveLength(0);
      expect(within(screen.getByRole('list', { name: 'Posts' })).getAllByRole('listitem')).toHaveLength(3);
      unmount();
    }
  });
});
