import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { FollowersTab, type FollowersTabProps } from '@/components/account/FollowersTab';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { followersView, type Snapshot } from '@/lib/followers/diff';
import { parseFollowerState, type SnapshotMeta } from '@/lib/followers/state';
import { DEFAULT_PREFS } from '@/lib/prefs';

const { push, replace, refresh } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push, replace, refresh, prefetch: vi.fn(), back: vi.fn() }) }));
const { download } = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock('@/lib/export/download', () => ({ downloadExport: download }));

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  for (const f of [push, replace, refresh, download]) f.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const T = en.pages.account.followerDiff;
const ACC = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const meta = (n: number, takenOn: string, followers: number, following: number | null): SnapshotMeta => ({ id: id(n), takenOn, followerCount: followers, followingCount: following, createdAt: `${takenOn}T10:00:00Z` });
const NEW_META = meta(2, '2026-10-20', 4, 3);
const OLD_META = meta(1, '2026-09-20', 3, null);
const at = (d: string) => Date.parse(`${d}T12:00:00Z`) / 1000;
const NEWER: Snapshot = {
  followers: [{ username: 'bob', at: at('2026-01-02') }, { username: 'cat', at: at('2026-01-03') }, { username: 'dan', at: at('2026-10-05') }, { username: 'eve', at: null }],
  following: [{ username: 'cat', at: at('2025-05-01') }, { username: 'dan', at: at('2025-06-01') }, { username: 'xavier', at: at('2025-07-01') }],
};
const OLDER: Snapshot = { followers: [{ username: 'amy', at: at('2025-12-01') }, { username: 'bob', at: at('2026-01-02') }, { username: 'cat', at: at('2026-01-03') }], following: null };
const SCOPE = { from: '2026-09-01', to: '2026-09-30' };
/** The list's table (the snapshot list below is a second table). */
const listTable = () => within(screen.getByRole('tabpanel')).getByRole('table');

function props(sp: Record<string, string> = {}, o: Partial<FollowersTabProps> = {}): FollowersTabProps {
  const snapshots = [NEW_META, OLD_META];
  const state = parseFollowerState(sp, snapshots);
  return { accountId: ACC, username: 'shop.one', today: '2026-10-21', scope: SCOPE, ready: true, snapshots, state, newer: NEW_META, older: OLD_META, view: followersView(NEWER, OLDER, state), deleteSnapshot: vi.fn(async () => ({ ok: true as const })), ...o };
}
function view(p: FollowersTabProps, locale: 'en' | 'zh-CN' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale, dateFormat: 'YYYY-MM-DD' }} persist={vi.fn()}>
        <FollowersTab {...p} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('FollowersTab', () => {
  it('migration missing: the guide and the "needs a database update" note, no upload', () => {
    view(props({}, { ready: false, snapshots: [], newer: null, older: null, view: null }));
    expect(screen.getByText(T.notReady)).toBeInTheDocument();
    expect(screen.getByText(T.guide.title)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: T.upload.open })).toBeNull();
  });

  it('no snapshot yet: the guide is open with the exact steps for this account, and the upload button', () => {
    view(props({}, { snapshots: [], newer: null, older: null, view: null }));
    const guide = screen.getByText(T.guide.title).closest('details')!;
    expect(guide).toHaveAttribute('open');
    const steps = within(guide).getAllByRole('listitem').map((li) => li.textContent);
    expect(steps).toHaveLength(7);
    expect(steps[0]).toContain('@shop.one');
    expect(steps[4]).toContain('JSON');
    expect(screen.getByText(T.empty)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: T.upload.open })).toBeInTheDocument();
  });

  it('the five lists as underline tabs with their sizes; New followers by default, newest follow first, snapshot-based note', () => {
    view(props());
    const tabs = within(screen.getByRole('tablist', { name: T.lists.label })).getAllByRole('tab');
    expect(screen.getByRole('tablist', { name: T.lists.label })).toHaveAttribute('data-variant', 'line');
    expect(tabs.map((t) => t.textContent)).toEqual(['New followers (2)', 'Unfollowed you (1)', "Don't follow you back (1)", "You don't follow back (2)", 'Mutuals (2)']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveTextContent('They follow you in the export of 2026-10-20 but not in the one of 2026-09-20.');
    expect(panel).toHaveTextContent(T.snapshotBased);
    expect(panel).toHaveTextContent('1–2 of 2 people');
    const table = within(panel).getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent));
    expect(rows).toEqual([['@dan', '2026-10-05'], ['@eve', '—']]);
    expect(within(table).getByRole('columnheader', { name: T.cols.followedYou })).toBeInTheDocument();
  });

  it('names link to Instagram in a new tab, safely', () => {
    view(props());
    const link = within(listTable()).getByRole('link', { name: 'Open @dan on Instagram' });
    expect(link).toHaveAttribute('href', 'https://www.instagram.com/dan/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('choosing a list navigates (scope kept, page dropped); the time column follows the list', async () => {
    const user = userEvent.setup();
    view(props({ list: 'theyDontFollow', page: '1' }));
    expect(within(listTable()).getByRole('columnheader', { name: T.cols.youFollowed })).toBeInTheDocument();
    expect(within(listTable()).getByText('@xavier')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Mutuals (2)' }));
    expect(push).toHaveBeenCalledWith('?tab=followers&list=mutual&from=2026-09-01&to=2026-09-30', { scroll: false });
  });

  it('toolbar: search, the snapshot and the comparison (named by date and size), export and upload; a search chip', () => {
    view(props({ q: 'da' }));
    const toolbar = screen.getByRole('group', { name: T.toolbar });
    expect(within(toolbar).getByRole('searchbox', { name: T.search })).toHaveValue('da');
    const snap = within(toolbar).getByLabelText(T.snapshot);
    expect(within(snap).getAllByRole('option').map((o) => o.textContent)).toEqual(['2026-10-20 · 4 followers', '2026-09-20 · 3 followers']);
    expect(within(toolbar).getByLabelText(T.compare)).toHaveValue(id(1));
    expect(within(toolbar).getByRole('button', { name: T.export })).toBeEnabled();
    expect(within(toolbar).getByRole('button', { name: T.upload.open })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Remove filter Search: da' })).toHaveAttribute('href', '?tab=followers&from=2026-09-01&to=2026-09-30');
    expect(within(listTable()).getAllByRole('row')).toHaveLength(2); // header + dan
  });

  it('a list the snapshots cannot answer says why (no second export / no following.json)', async () => {
    const state = parseFollowerState({ list: 'lost' }, [NEW_META]);
    view(props({}, { snapshots: [NEW_META], older: null, state, view: followersView(NEWER, null, state) }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent(T.needTwo);
    expect(screen.queryByLabelText(T.compare)).toBeNull(); // one snapshot: nothing to compare with
    expect(screen.getByRole('button', { name: T.export })).toBeDisabled();
  });

  it('export downloads the current list through the safe xlsx route; an error key is shown translated', async () => {
    const user = userEvent.setup();
    download.mockResolvedValueOnce({ ok: false, error: 'unauthorized' });
    view(props({ list: 'lost', q: 'am' }));
    await user.click(screen.getByRole('button', { name: T.export }));
    expect(download).toHaveBeenCalledWith(`/api/export/followers?account=${ACC}&snap=${id(2)}&vs=${id(1)}&list=lost&q=am`, 'xlsx');
    expect(await screen.findByRole('alert')).toHaveTextContent(en.export.errors.unauthorized);
  });

  it('snapshots: date, counts, "Not uploaded" without following.json; delete asks first, then refreshes', async () => {
    const user = userEvent.setup();
    const p = props();
    view(p);
    const section = screen.getByRole('region', { name: T.snapshots.title });
    expect(section).toHaveTextContent(T.snapshots.notUploaded);
    await user.click(within(section).getAllByRole('button', { name: 'Delete the snapshot of 2026-09-20' })[0]); // the table and the phone cards both render it
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('The usernames of the export of 2026-09-20 are removed for good.');
    await user.click(within(dialog).getByRole('button', { name: T.snapshots.confirm }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(p.deleteSnapshot).toHaveBeenCalledWith(ACC, id(1));
  });

  it('deleting a snapshot that is already gone says so (not "this account no longer exists")', async () => {
    const user = userEvent.setup();
    const p = props({}, { deleteSnapshot: vi.fn(async () => ({ ok: false as const, error: 'notFound' })) });
    view(p);
    await user.click(within(screen.getByRole('region', { name: T.snapshots.title })).getAllByRole('button', { name: 'Delete the snapshot of 2026-09-20' })[0]);
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: T.snapshots.confirm }));
    const dialog = await screen.findByRole('alertdialog');
    await waitFor(() => expect(dialog).toHaveTextContent('That snapshot was already deleted.'));
    expect(dialog).not.toHaveTextContent(T.errors.notFound);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('two snapshots that look identical (same day, same size, nothing new or lost) get a quiet hint, not just "0 new"', () => {
    const twin = meta(1, '2026-10-20', 4, 3);
    const state = parseFollowerState({}, [NEW_META, twin]);
    view(props({}, { snapshots: [NEW_META, twin], older: twin, state, view: followersView(NEWER, NEWER, state) }));
    expect(screen.getByText(T.identical)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: T.upload.open })).toBeEnabled(); // uploads are not blocked
  });

  it('no identical hint for a real comparison, or when the sizes or days differ', () => {
    view(props());
    expect(screen.queryByText(T.identical)).toBeNull();
  });

  it('an export older than 30 days gets one quiet line, nothing more', () => {
    view(props({}, { today: '2026-11-25' }));
    expect(screen.getByText('Your newest export is 36 days old. Upload a new one to see recent changes.')).toBeInTheDocument();
  });

  it('zh-CN', () => {
    view(props(), 'zh-CN');
    expect(screen.getByRole('tab', { name: '新粉丝（2）' })).toBeInTheDocument();
  });
});
