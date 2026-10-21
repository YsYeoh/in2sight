import { describe, expect, it } from 'vitest';
import { HISTORY_MAX, HOME, LIVE_CAP, STALE_MS, initialTabs, isTabPath, liveIds, navKeyOf, navMatches, pathOf, serialize, tabsReducer, type OpenMode, type TabsAction, type TabsState } from '@/lib/tabs/model';

const run = (s: TabsState, ...actions: TabsAction[]) => actions.reduce(tabsReducer, s);
const urls = (s: TabsState) => s.tabs.map((t) => t.url);
const tab = (s: TabsState, id = s.active) => s.tabs.find((t) => t.id === id)!;
const open = (url: string, mode: OpenMode, now = 1000): TabsAction => ({ type: 'open', url, mode, now });
const report = (url: string, title = '', id = 't0'): TabsAction => ({ type: 'report', id, url, title });

describe('tab paths', () => {
  it('isTabPath: the six main pages and everything below them, nothing else', () => {
    for (const p of ['/overview', '/accounts', '/accounts/7b0c', '/accounts/7b0c/media/123', '/tags', '/calendar', '/explorer', '/settings']) expect(isTabPath(p), p).toBe(true);
    for (const p of ['/', '/login', '/login/verify', '/setup', '/auth/signout', '/report', '/report/print', '/styleguide', '/api/export/xlsx', '/offline', '/accounts-x']) expect(isTabPath(p), p).toBe(false);
  });

  it('pathOf drops query and hash; navMatches: "Accounts" matches the list page only, the others match their sub-pages', () => {
    expect(pathOf('/accounts/1?tab=posts#x')).toBe('/accounts/1');
    expect(navMatches('/accounts', '/accounts')).toBe(true);
    expect(navMatches('/accounts?x=1', '/accounts')).toBe(true);
    expect(navMatches('/accounts/1', '/accounts')).toBe(false);
    expect(navMatches('/overview?from=2026-09-01', '/overview?from=2026-10-01')).toBe(true);
    expect(navMatches('/settings/notifications', '/settings')).toBe(true);
    expect(navMatches('/tags', '/overview')).toBe(false);
  });

  it('navKeyOf names the section of a URL (account pages belong to Accounts)', () => {
    expect(navKeyOf('/explorer?m=reach')).toBe('explorer');
    expect(navKeyOf('/accounts/1/media/2')).toBe('accounts');
    expect(navKeyOf('/login')).toBeNull();
  });
});

describe('tabsReducer', () => {
  it('starts with one active tab t0 for the current URL, nothing reported yet', () => {
    expect(initialTabs('/explorer?m=reach')).toEqual({
      tabs: [{ id: 't0', url: '/explorer?m=reach', title: '', back: [], fwd: [], viewedAt: 0, frameUrl: null, stale: false }],
      active: 't0',
      next: 1,
      cap: LIVE_CAP,
    });
  });

  it('open "new" appends a tab and activates it; "exact" jumps to the tab with that exact URL or opens one', () => {
    let s = run(initialTabs('/overview'), open('/tags', 'new'));
    expect(urls(s)).toEqual(['/overview', '/tags']);
    expect(s.active).toBe('t1');
    s = run(s, open('/overview', 'exact', 2000));
    expect(s.active).toBe('t0');
    expect(s.tabs).toHaveLength(2);
    s = run(s, open('/overview?from=2026-09-01', 'exact', 3000));
    expect(urls(s)).toEqual(['/overview', '/tags', '/overview?from=2026-09-01']);
    expect(s.active).toBe('t2');
  });

  it('open "nav" (sidebar): the active tab if it matches, else the most recently viewed match, else a new tab', () => {
    let s = run(initialTabs('/accounts/1'), open('/accounts', 'nav'));
    expect(urls(s)).toEqual(['/accounts/1', '/accounts']); // an account page is not the Accounts list
    s = run(s, open('/overview', 'new', 2000), open('/overview?x=1', 'new', 3000), open('/tags', 'new', 4000));
    s = run(s, open('/overview', 'nav', 5000));
    expect(tab(s).url).toBe('/overview?x=1'); // left at 4000; the other Overview tab was left at 3000
    s = run(s, open('/overview?from=2026-01-01', 'nav', 6000));
    expect(tab(s).url).toBe('/overview?x=1'); // already on an Overview tab: stays there
    expect(s.tabs).toHaveLength(5);
  });

  it('open "current" (phone bottom bar) navigates the active tab and records it in its own Back stack', () => {
    const s = run(initialTabs('/overview'), report('/overview', 'Overview'), open('/tags', 'current'));
    expect(s.tabs).toHaveLength(1);
    expect(tab(s)).toMatchObject({ url: '/tags', frameUrl: '/overview', back: ['/overview'], fwd: [] }); // url ≠ frameUrl: the shell must send "go"
    expect(run(s, open('/tags', 'current'))).toEqual(s);
  });

  it('report: the first report after mount (also a redirect) only records; a later different URL is a navigation in the tab', () => {
    let s = run(initialTabs('/accounts/1?tab=audience'), report('/accounts/1?tab=overview', '@a · Overview'));
    expect(tab(s)).toMatchObject({ url: '/accounts/1?tab=overview', frameUrl: '/accounts/1?tab=overview', back: [], title: '@a · Overview' });
    s = run(s, report('/accounts/1?tab=posts'));
    expect(tab(s)).toMatchObject({ url: '/accounts/1?tab=posts', back: ['/accounts/1?tab=overview'], fwd: [], title: '' }); // the old title is not kept for a new page
    s = run(s, report('/accounts/1?tab=posts', '@a · Posts'));
    expect(tab(s)).toMatchObject({ title: '@a · Posts', back: ['/accounts/1?tab=overview'] }); // same URL: a title update only
  });

  it('step: Back/Forward move along the tab’s own stacks; the frame’s later reports do not add entries', () => {
    let s = run(initialTabs('/overview'), report('/overview', 'O'), report('/tags', 'T'), report('/explorer', 'E'));
    expect(tab(s).back).toEqual(['/overview', '/tags']);
    s = run(s, { type: 'step', id: 't0', dir: -1 });
    expect(tab(s)).toMatchObject({ url: '/tags', frameUrl: '/explorer', back: ['/overview'], fwd: ['/explorer'] });
    s = run(s, report('/explorer', 'E')); // a late title report from the old page: not a navigation
    expect(tab(s)).toMatchObject({ url: '/tags', back: ['/overview'], fwd: ['/explorer'] });
    s = run(s, report('/tags', 'T')); // the frame arrived
    expect(tab(s)).toMatchObject({ url: '/tags', frameUrl: '/tags', back: ['/overview'], fwd: ['/explorer'] });
    s = run(s, { type: 'step', id: 't0', dir: 1 });
    expect(tab(s)).toMatchObject({ url: '/explorer', back: ['/overview', '/tags'], fwd: [] });
    expect(run(s, { type: 'step', id: 't0', dir: 1 })).toEqual(s); // nothing forward
    expect(run(initialTabs('/overview'), { type: 'step', id: 't0', dir: -1 })).toEqual(initialTabs('/overview')); // nothing back
  });

  it('two steps back, then the frame reports the intermediate URL and then the final one: the stacks end consistent and Forward survives', () => {
    let s = run(initialTabs('/overview'), report('/overview'), report('/tags'), report('/explorer'));
    s = run(s, { type: 'step', id: 't0', dir: -1 }, { type: 'step', id: 't0', dir: -1 });
    expect(tab(s)).toMatchObject({ url: '/overview', frameUrl: '/explorer', back: [], fwd: ['/tags', '/explorer'] });
    s = run(s, report('/tags')); // the first go landed: a step on the way, not a navigation
    expect(tab(s)).toMatchObject({ url: '/overview', frameUrl: '/tags', back: [], fwd: ['/tags', '/explorer'] });
    s = run(s, report('/overview'));
    expect(tab(s)).toMatchObject({ url: '/overview', frameUrl: '/overview', back: [], fwd: ['/tags', '/explorer'] });
    s = run(s, { type: 'step', id: 't0', dir: 1 });
    expect(tab(s)).toMatchObject({ url: '/tags', back: ['/overview'], fwd: ['/explorer'] });
  });

  it('a redirected go: the tab follows the frame afterwards without phantom entries', () => {
    let s = run(initialTabs('/overview'), report('/overview'), report('/tags'), { type: 'step', id: 't0', dir: -1 });
    s = run(s, report('/overview?x=1')); // the frame was redirected on its way back
    expect(tab(s)).toMatchObject({ url: '/overview?x=1', frameUrl: '/overview?x=1', back: [], fwd: ['/tags'] });
    s = run(s, report('/calendar'));
    expect(tab(s)).toMatchObject({ url: '/calendar', back: ['/overview?x=1'], fwd: [] });
  });

  it('step does nothing before the frame has reported; a bottom-bar tap then opens the page like a link (it would be lost otherwise)', () => {
    const s = initialTabs('/overview');
    expect(run(s, { type: 'step', id: 't0', dir: -1 })).toEqual(s);
    const t = run(s, open('/tags', 'current'));
    expect(urls(t)).toEqual(['/overview', '/tags']);
    expect(tab(t, 't0')).toMatchObject({ url: '/overview', back: [] });
  });

  it('a new navigation clears Forward; the Back stack keeps the last HISTORY_MAX entries', () => {
    let s = run(initialTabs('/overview'), report('/overview'));
    for (let i = 0; i < HISTORY_MAX + 5; i++) s = run(s, report(`/explorer?i=${i}`));
    expect(tab(s).back).toHaveLength(HISTORY_MAX);
    expect(tab(s).back.at(-1)).toBe(`/explorer?i=${HISTORY_MAX + 3}`);
    s = run(s, { type: 'step', id: 't0', dir: -1 });
    s = run(s, report(tab(s).url));
    expect(tab(s).fwd).toEqual([`/explorer?i=${HISTORY_MAX + 4}`]);
    s = run(s, report('/tags'));
    expect(tab(s).fwd).toEqual([]);
  });

  it('close: the active tab hands over to its right neighbour, else the left one; the last tab becomes Overview', () => {
    let s = run(initialTabs('/overview'), open('/tags', 'new', 2), open('/calendar', 'new', 3), { type: 'activate', id: 't1', now: 4 });
    s = run(s, { type: 'close', id: 't1', now: 5 });
    expect(s.active).toBe('t2');
    s = run(s, { type: 'close', id: 't2', now: 6 });
    expect(s.active).toBe('t0');
    s = run(s, { type: 'close', id: 't0', now: 7 });
    expect(urls(s)).toEqual([HOME]);
    expect(s.active).toBe('t3');
    expect(run(s, { type: 'close', id: 'nope', now: 8 })).toEqual(s);
  });

  it('closing an inactive tab keeps the active one', () => {
    const s = run(initialTabs('/overview'), open('/tags', 'new', 2), { type: 'close', id: 't0', now: 3 });
    expect(s.active).toBe('t1');
    expect(urls(s)).toEqual(['/tags']);
  });

  it('liveIds: the active tab plus the most recently viewed others, up to the cap; never-viewed tabs are not live', () => {
    let s = run(initialTabs('/overview'), { type: 'cap', cap: 3 });
    for (let i = 1; i <= 4; i++) s = run(s, open(`/explorer?i=${i}`, 'new', i * 10));
    // t4 active; t3 left at 40, t2 at 30, t1 at 20, t0 at 10
    expect([...liveIds(s)].sort()).toEqual(['t2', 't3', 't4']);
    s = run(s, { type: 'restore', raw: JSON.stringify({ v: 1, tabs: [{ url: '/tags', title: 'Tags' }] }) });
    expect(s.tabs.some((t) => t.url === '/tags' && !liveIds(s).has(t.id))).toBe(true); // restored, never viewed: mounts only when selected
  });

  it('a discarded frame forgets its report, so the next mount loads its URL fresh', () => {
    let s = run(initialTabs('/overview'), { type: 'cap', cap: 2 }, report('/overview', 'O'));
    s = run(s, open('/tags', 'new', 10), open('/calendar', 'new', 20)); // t0 falls out of the 2 live frames
    expect(tab(s, 't0')).toMatchObject({ url: '/overview', frameUrl: null, title: 'O' });
  });

  it('stale: a live tab not viewed for STALE_MS is marked when activated; refreshed clears it; a discarded tab is not stale', () => {
    let s = run(initialTabs('/overview'), open('/tags', 'new', 1000));
    s = run(s, { type: 'activate', id: 't0', now: 1000 + STALE_MS - 1 });
    expect(tab(s).stale).toBe(false);
    s = run(s, { type: 'activate', id: 't1', now: 1000 + 2 * STALE_MS });
    expect(tab(s).stale).toBe(true);
    s = run(s, { type: 'refreshed', id: 't1' });
    expect(tab(s).stale).toBe(false);
    let d = run(initialTabs('/overview'), { type: 'cap', cap: 1 }, open('/tags', 'new', 1000));
    d = run(d, { type: 'activate', id: 't0', now: 1000 + 2 * STALE_MS });
    expect(tab(d).stale).toBe(false);
  });

  it('restore: saved tabs come back with their titles, the current URL keeps t0 and stays active; junk is ignored', () => {
    const raw = JSON.stringify({ v: 1, tabs: [{ url: '/tags', title: 'Tags' }, { url: '/explorer?m=reach', title: 'Explorer' }, { url: '/login', title: 'x' }, { url: '//evil.test/overview', title: 'x' }, { url: 'https://evil.test/overview' }, { url: 5 }, { url: '/calendar' }] });
    const s = run(initialTabs('/explorer?m=reach'), { type: 'restore', raw });
    expect(urls(s)).toEqual(['/tags', '/explorer?m=reach', '/calendar']);
    expect(tab(s)).toMatchObject({ id: 't0', url: '/explorer?m=reach', title: 'Explorer' });
    expect(s.tabs.map((t) => t.title)).toEqual(['Tags', 'Explorer', '']);
    expect(new Set(s.tabs.map((t) => t.id)).size).toBe(3);
    const t = run(initialTabs('/settings'), { type: 'restore', raw });
    expect(urls(t)).toEqual(['/tags', '/explorer?m=reach', '/calendar', '/settings']);
    expect(t.active).toBe('t0');
    for (const bad of [null, '', '{', '[]', '{"v":2,"tabs":[{"url":"/tags"}]}', '{"v":1,"tabs":"x"}', '{"v":1,"tabs":[null]}']) expect(run(initialTabs('/tags'), { type: 'restore', raw: bad }), String(bad)).toEqual(initialTabs('/tags'));
  });

  it('restore: paths are normalised (a traversal out of a tab page is dropped, dot segments resolve) and at most 50 tabs come back', () => {
    const raw = JSON.stringify({ v: 1, tabs: [{ url: '/overview/../login' }, { url: '/accounts/../tags?x=1' }, { url: '/\\evil.test/overview' }, { url: '/calendar' }] });
    expect(urls(run(initialTabs('/overview'), { type: 'restore', raw }))).toEqual(['/tags?x=1', '/calendar', '/overview']);
    const many = JSON.stringify({ v: 1, tabs: Array.from({ length: 1000 }, (_, i) => ({ url: `/explorer?i=${i}`, title: 'x' })) });
    const s = run(initialTabs('/overview'), { type: 'restore', raw: many });
    expect(s.tabs).toHaveLength(50);
    expect(s.active).toBe('t0');
    expect(tab(s).url).toBe('/overview');
  });

  it('serialize writes urls and titles only, and restore reads it back', () => {
    const s = run(initialTabs('/overview'), report('/overview', 'Overview'), open('/tags', 'new'));
    expect(JSON.parse(serialize(s))).toEqual({ v: 1, tabs: [{ url: '/overview', title: 'Overview' }, { url: '/tags', title: '' }] });
    expect(urls(run(initialTabs('/tags'), { type: 'restore', raw: serialize(s) }))).toEqual(['/overview', '/tags']);
  });
});
