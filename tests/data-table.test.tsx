import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import { DataTable, sortRows, type Column } from '@/components/shared/DataTable';

type R = { name: string; reach: number | null };
const rows: R[] = [
  { name: 'beta', reach: 50 },
  { name: 'alpha', reach: null },
  { name: 'gamma', reach: 900 },
];
const columns: Column<R>[] = [
  { key: 'name', header: 'Account', cell: (r) => `@${r.name}`, sortValue: (r) => r.name },
  { key: 'reach', header: 'Reach', cell: (r) => String(r.reach ?? '—'), sortValue: (r) => r.reach, align: 'right' },
];

function setup(props: Partial<React.ComponentProps<typeof DataTable<R>>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.name} caption="Accounts compared" {...props} />
    </NextIntlClientProvider>,
  );
}

describe('sortRows', () => {
  it('sorts numbers and strings both ways; nulls always last; stable for ties', () => {
    expect(sortRows(rows, columns, { key: 'reach', dir: 'desc' }).map((r) => r.name)).toEqual(['gamma', 'beta', 'alpha']);
    expect(sortRows(rows, columns, { key: 'reach', dir: 'asc' }).map((r) => r.name)).toEqual(['beta', 'gamma', 'alpha']);
    expect(sortRows(rows, columns, { key: 'name', dir: 'asc' }).map((r) => r.name)).toEqual(['alpha', 'beta', 'gamma']);
    expect(sortRows(rows, columns, null)).toBe(rows);
    const ties = [{ name: 'x', reach: 1 }, { name: 'y', reach: 1 }];
    expect(sortRows(ties, columns, { key: 'reach', dir: 'desc' }).map((r) => r.name)).toEqual(['x', 'y']);
  });
});

describe('DataTable', () => {
  it('renders a table (md+) and a card list (phones) from the same rows', () => {
    setup();
    const table = screen.getByRole('table', { name: 'Accounts compared' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    const list = screen.getByRole('list', { name: 'Accounts compared' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(table.closest('.hidden.md\\:block')).not.toBeNull();
    expect(list.closest('.md\\:hidden')).not.toBeNull();
  });

  it('clicking a header sorts (descending first) and announces it with aria-sort', async () => {
    setup();
    const table = screen.getByRole('table');
    await userEvent.click(within(table).getByRole('button', { name: /Reach/ }));
    expect(within(table).getByRole('columnheader', { name: /Reach/ })).toHaveAttribute('aria-sort', 'descending');
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('@gamma');
    await userEvent.click(within(table).getByRole('button', { name: /Reach/ }));
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('@beta');
  });

  it('phones sort with a native select', async () => {
    setup();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: en.table.sortBy }), 'reach');
    expect(within(screen.getByRole('list')).getAllByRole('listitem')[0]).toHaveTextContent('@gamma');
  });

  it('phones can flip the sort direction', async () => {
    setup();
    const dir = screen.getByRole('button', { name: en.table.ascending });
    expect(dir).toBeDisabled();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: en.table.sortBy }), 'reach');
    expect(dir).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(dir);
    expect(dir).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByRole('list')).getAllByRole('listitem')[0]).toHaveTextContent('@beta');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: en.table.sortBy }), 'name'); // keeps the direction
    expect(dir).toHaveAttribute('aria-pressed', 'true');
  });

  it('empty and loading states', () => {
    const { unmount } = setup({ rows: [] });
    expect(screen.getByText(en.table.empty)).toBeInTheDocument();
    unmount();
    setup({ loading: true });
    expect(screen.queryByText('@beta')).toBeNull();
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });
});
