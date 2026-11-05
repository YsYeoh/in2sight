import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { PlannerBoard, type PlannerBoardProps } from '@/components/plan/PlannerBoard';
import type { PlannerItem } from '@/lib/planner/items';
import { DEFAULT_PREFS } from '@/lib/prefs';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  push.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const B = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const GONE = '99999999-9999-4999-8999-999999999999'; // an archived account
const T1 = '00000000-0000-4000-8000-000000000001';
const P = en.planner;
const item = (o: Partial<PlannerItem>): PlannerItem => ({ id: 'i', accountId: A, title: 't', notes: '', status: 'idea', format: null, plannedDay: null, plannedHour: null, tagIds: [], mediaId: null, createdAt: '2026-10-01T00:00:00Z', ...o });
const ITEMS = [
  item({ id: 'i1', title: '<b>Studio tour</b>', notes: 'line 1\nline 2', format: 'REELS', plannedDay: '2026-11-10', plannedHour: 19, tagIds: [T1, 'deleted-tag'] }),
  item({ id: 'i2', title: 'Q&A carousel', status: 'drafting', accountId: B }),
  item({ id: 'i3', title: 'Launch post', status: 'posted', mediaId: '178' }),
  item({ id: 'i4', title: 'Hidden', accountId: GONE }),
];
const ok = async () => ({ ok: true as const });

function board(o: Partial<PlannerBoardProps> = {}, messages: typeof en = en) {
  const props: PlannerBoardProps = {
    items: ITEMS,
    accounts: [
      { id: A, username: 'alice' },
      { id: B, username: 'bob' },
    ],
    account: null,
    tags: [{ id: T1, name: 'Promo', color: 'chart-2' }],
    media: [
      { id: '178', accountId: A, mediaType: 'REELS', postedAt: '2026-10-02T10:00:00Z', cover: 'pending', caption: 'Launch' }, // linked to i3: never offered to another card
      { id: '179', accountId: A, mediaType: 'REELS', postedAt: '2026-11-10T19:30:00Z', cover: 'pending', caption: 'Tour' },
    ],
    save: vi.fn(ok),
    move: vi.fn(ok),
    remove: vi.fn(ok),
    suggest: vi.fn(async () => ({ ok: true as const, slots: [{ day: '2026-11-12', hour: 18, value: 0.081, count: 4 }], sample: 42, reason: null })),
    ...o,
  };
  render(
    <NextIntlClientProvider locale={messages === en ? 'en' : 'zh-CN'} messages={messages}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, timezone: 'UTC', timeFormat: '24h', dateFormat: 'YYYY-MM-DD' }} persist={vi.fn()}>
        <PlannerBoard {...props} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
  return props;
}
const column = (name: string) => screen.getByRole('region', { name: new RegExp(`^${name}`) });

describe('PlannerBoard', () => {
  it('four columns in order with counts; cards show the account, format, planned time, notes and known tags as text', () => {
    board();
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-labelledby'))).toEqual(['plan-col-idea', 'plan-col-drafting', 'plan-col-ready', 'plan-col-posted']);
    const ideas = column(P.status.idea);
    expect(within(ideas).getByText('1 card')).toBeInTheDocument();
    const card = within(ideas).getByRole('listitem');
    expect(within(card).getByRole('button', { name: `Edit ${ITEMS[0].title}` })).toHaveTextContent('<b>Studio tour</b>'); // text, never HTML
    expect(card).toHaveTextContent('@alice');
    expect(card).toHaveTextContent('Reel');
    expect(card).toHaveTextContent('2026-11-10 19:00');
    expect(card).toHaveTextContent('Promo');
    expect(card.querySelectorAll('[style]').length).toBeGreaterThan(0); // the known tag badge; the unknown id is skipped
    expect(within(column(P.status.ready)).getByText(P.emptyColumn)).toBeInTheDocument();
    expect(screen.queryByText('Hidden')).toBeNull(); // archived account
    expect(within(column(P.status.posted)).getByRole('link', { name: P.openPost })).toHaveAttribute('href', `/accounts/${A}/media/178`);
  });

  it('keyboard path: the arrow buttons move a card one column and announce it; edges have no button', async () => {
    const user = userEvent.setup();
    const p = board();
    const ideas = column(P.status.idea);
    expect(within(ideas).queryByRole('button', { name: /to Ideas/ })).toBeNull();
    await user.click(within(ideas).getByRole('button', { name: `Move ${ITEMS[0].title} to Drafting` }));
    expect(p.move).toHaveBeenCalledWith('i1', 'drafting');
    expect(await screen.findByRole('status')).toHaveTextContent(`Moved ${ITEMS[0].title} to Drafting.`);
    await user.click(within(column(P.status.drafting)).getByRole('button', { name: 'Move Q&A carousel to Ideas' }));
    expect(p.move).toHaveBeenLastCalledWith('i2', 'idea');
    expect(within(column(P.status.posted)).queryByRole('button', { name: /^Move .* to (?!Ready)/ })).toBeNull();
  });

  it('drag and drop moves a card; dropping on its own column does nothing', () => {
    const p = board();
    const dt = { getData: () => 'i1', setData: vi.fn() };
    fireEvent.drop(column(P.status.ready), { dataTransfer: dt });
    expect(p.move).toHaveBeenCalledWith('i1', 'ready');
    fireEvent.drop(column(P.status.idea), { dataTransfer: dt });
    expect(p.move).toHaveBeenCalledTimes(1);
    const card = within(column(P.status.idea)).getByRole('listitem');
    expect(card).toHaveAttribute('draggable', 'true');
    fireEvent.dragStart(card, { dataTransfer: dt });
    expect(dt.setData).toHaveBeenCalledWith('text/plain', 'i1');
  });

  it('a failed move shows the error key as an alert', async () => {
    const user = userEvent.setup();
    board({ move: vi.fn(async () => ({ ok: false as const, error: 'needs_update' as const })) });
    await user.click(screen.getByRole('button', { name: `Move ${ITEMS[0].title} to Drafting` }));
    expect(await screen.findByRole('alert')).toHaveTextContent(P.errors.needs_update);
  });

  it('the account filter navigates on the page the board lives on', async () => {
    const user = userEvent.setup();
    board({ account: B });
    await user.selectOptions(screen.getByLabelText(P.account), '@alice');
    expect(push).toHaveBeenLastCalledWith(`/plan?account=${A}`, { scroll: false });
    await user.selectOptions(screen.getByLabelText(P.account), P.allAccounts);
    expect(push).toHaveBeenLastCalledWith('/plan', { scroll: false });
  });

  it('under Plan 17d the board keeps its section path', async () => {
    const user = userEvent.setup();
    board({ basePath: '/plan/board' });
    await user.selectOptions(screen.getByLabelText(P.account), '@bob');
    expect(push).toHaveBeenLastCalledWith(`/plan/board?account=${B}`, { scroll: false });
  });

  it('one account: no filter, no handle on cards; a filtered board shows only that account', () => {
    board({ accounts: [{ id: A, username: 'alice' }] });
    expect(screen.queryByLabelText(P.account)).toBeNull();
    expect(screen.queryByText('@alice')).toBeNull();
    expect(screen.queryByText('Q&A carousel')).toBeNull();
  });

  it('empty and no-account states', () => {
    board({ items: [] });
    expect(screen.getByText(P.emptyTitle)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: P.new })).toBeInTheDocument();
  });

  it('no live account: says to connect one, no New button', () => {
    board({ accounts: [] });
    expect(screen.getByText(P.noAccounts)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: P.new })).toBeNull();
  });

  it('New idea: title required, saves the trimmed form with the filtered account, closes and announces', async () => {
    const user = userEvent.setup();
    const p = board({ account: B });
    await user.click(screen.getByRole('button', { name: P.new }));
    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: P.dialog.save });
    expect(save).toBeDisabled();
    await user.type(within(dialog).getByLabelText(new RegExp(P.dialog.titleLabel)), 'Behind the scenes');
    await user.type(within(dialog).getByLabelText(P.dialog.notes), 'Shot list');
    await user.selectOptions(within(dialog).getByLabelText(P.dialog.format), 'REELS');
    expect(within(dialog).queryByText(P.dialog.link)).toBeNull(); // only for Ready / Posted
    await user.click(save);
    expect(p.save).toHaveBeenCalledWith(null, { accountId: B, title: 'Behind the scenes', notes: 'Shot list', status: 'idea', format: 'REELS', plannedDay: null, plannedHour: null, tagIds: [], mediaId: null });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(P.dialog.saved);
  });

  it('Suggest a time: shows the basis with n and fills the day and hour', async () => {
    const user = userEvent.setup();
    const p = board();
    await user.click(screen.getByRole('button', { name: `Edit ${ITEMS[0].title}` }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: P.dialog.suggest }));
    expect(p.suggest).toHaveBeenCalledWith(A);
    expect(within(dialog).getByText(/42 posts\. Pattern, not proof\./)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '2026-11-12, 18:00' }));
    expect(within(dialog).getByLabelText(P.dialog.day)).toHaveValue('2026-11-12');
    expect(within(dialog).getByLabelText(P.dialog.hour)).toHaveValue('18');
    await user.click(within(dialog).getByRole('button', { name: P.dialog.save }));
    expect(p.save).toHaveBeenCalledWith('i1', expect.objectContaining({ plannedDay: '2026-11-12', plannedHour: 18, tagIds: [T1] })); // the unknown tag id is dropped
  });

  it('Suggest a time with too few posts says why, with n', async () => {
    const user = userEvent.setup();
    board({ suggest: vi.fn(async () => ({ ok: true as const, slots: [], sample: 7, reason: 'not_enough_posts' as const })) });
    await user.click(screen.getByRole('button', { name: `Edit ${ITEMS[0].title}` }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: P.dialog.suggest }));
    expect(screen.getByText(`${en.analysis.reasons.not_enough_posts} (n = 7 posts)`)).toBeInTheDocument();
  });

  it('linking a recent post moves the card to Posted; the nearest post is marked as a match', async () => {
    const user = userEvent.setup();
    const p = board();
    await user.click(screen.getByRole('button', { name: `Edit ${ITEMS[0].title}` }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(P.dialog.column), 'ready');
    const fieldset = within(dialog).getByRole('group', { name: P.dialog.link });
    expect(within(fieldset).getByText(P.dialog.match)).toBeInTheDocument();
    const radios = within(fieldset).getAllByRole('radio');
    expect(radios).toHaveLength(2); // "Not linked" + the Reel posted 30 minutes after the planned 19:00 (178 belongs to i3)
    await user.click(radios[1]);
    expect(within(dialog).getByLabelText(P.dialog.column)).toHaveValue('posted');
    await user.click(within(dialog).getByRole('button', { name: P.dialog.save }));
    expect(p.save).toHaveBeenCalledWith('i1', expect.objectContaining({ status: 'posted', mediaId: '179' }));
  });

  it('Delete asks first, then removes', async () => {
    const user = userEvent.setup();
    const p = board();
    await user.click(screen.getByRole('button', { name: 'Edit Q&A carousel' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: P.dialog.delete }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Q&A carousel is removed from the board.');
    await user.click(within(confirm).getByRole('button', { name: P.dialog.delete }));
    expect(p.remove).toHaveBeenCalledWith('i2');
  });

  it('zh-CN renders the column names', () => {
    board({}, zh as unknown as typeof en);
    expect(screen.getByRole('heading', { name: /^创意/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^已发布/ })).toBeInTheDocument();
  });
});
