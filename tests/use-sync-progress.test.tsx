import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountProgress } from '@/lib/sync/progress';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { IDLE_MS, MAX_BACKOFF_MS, POLL_MS, useSyncProgress } from '@/components/accounts/useSyncProgress';

const progress = (o: Partial<AccountProgress> = {}): AccountProgress => ({
  accountId: 'a1',
  phase: 'running',
  percent: 10,
  stages: [{ stage: 'profile', state: 'done', done: null, total: null, reason: null }, { stage: 'account_days', state: 'running', done: 9, total: 90, reason: null }],
  current: { stage: 'account_days', day: '2026-10-05', done: 9, total: 90 },
  startedAt: '2026-10-14T02:00:00Z',
  elapsedMs: 10_000,
  etaMs: null,
  resumeInMs: null,
  errorKey: null,
  summary: { days: 9, posts: 0 },
  ...o,
});
const BOTH_DONE: AccountProgress['stages'] = [{ stage: 'profile', state: 'done', done: null, total: null, reason: null }, { stage: 'account_days', state: 'done', done: 90, total: 90, reason: null }];
/** the server render's value: one stable array, like a server component prop */
const INIT = [progress()];
const DONE = [progress({ phase: 'done', percent: 100 })];
const FAILED = [progress({ phase: 'failed' })];
const RECONNECT = [progress({ phase: 'needs_reconnect' })];
const WAITING = [progress({ phase: 'waiting' })];
const ok = (accounts: AccountProgress[]) => new Response(JSON.stringify({ accounts }), { status: 200, headers: { 'content-type': 'application/json' } });
let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockReset();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useSyncProgress', () => {
  it('does not poll when nothing is running', async () => {
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    renderHook(() => useSyncProgress(DONE));
    await act(() => vi.advanceTimersByTimeAsync(4 * POLL_MS));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('failed / stalled / rate limited accounts are checked only once a minute; needs_reconnect is not polled at all', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok([progress({ phase: 'failed' })]));
    vi.stubGlobal('fetch', fetchFn);
    renderHook(() => useSyncProgress(FAILED));
    await act(() => vi.advanceTimersByTimeAsync(IDLE_MS - 1));
    expect(fetchFn).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    renderHook(() => useSyncProgress(RECONNECT));
    await act(() => vi.advanceTimersByTimeAsync(3 * IDLE_MS));
    expect(fetchFn).toHaveBeenCalledTimes(4); // only the failed one, once per minute
  });

  it('slows to the idle cadence when a running account turns failed, and speeds up for a waiting one', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(ok([progress({ phase: 'failed' })])).mockResolvedValue(ok([progress({ phase: 'failed' })]));
    vi.stubGlobal('fetch', fetchFn);
    renderHook(() => useSyncProgress(INIT));
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(IDLE_MS - 1));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const waiting = vi.fn().mockResolvedValue(ok([progress({ phase: 'waiting' })]));
    vi.stubGlobal('fetch', waiting);
    renderHook(() => useSyncProgress(WAITING));
    await act(() => vi.advanceTimersByTimeAsync(2 * POLL_MS));
    expect(waiting).toHaveBeenCalledTimes(2);
  });

  it('polls every 3 s while running, adopts the answer, refreshes on each completed stage and stops when done', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(ok([progress({ percent: 30 })]))
      .mockResolvedValueOnce(ok([progress({ percent: 60, stages: BOTH_DONE })]))
      .mockResolvedValue(ok([progress({ phase: 'done', percent: 100, stages: BOTH_DONE })]));
    vi.stubGlobal('fetch', fetchFn);
    const { result } = renderHook(() => useSyncProgress(INIT));
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(fetchFn).toHaveBeenCalledWith('/api/sync/progress', expect.objectContaining({ cache: 'no-store' }));
    expect(result.current[0].percent).toBe(30);
    expect(refresh).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(result.current[0].percent).toBe(60);
    expect(refresh).toHaveBeenCalledTimes(1); // account days finished: show the new numbers
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(result.current[0].phase).toBe('done');
    expect(refresh).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(5 * POLL_MS));
    expect(fetchFn).toHaveBeenCalledTimes(3); // stopped
  });

  it('backs off on errors: 3 s, then 6 s, then 12 s … capped at 60 s', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', fetchFn);
    renderHook(() => useSyncProgress(INIT));
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(2 * POLL_MS - 1));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetchFn).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(4 * POLL_MS));
    expect(fetchFn).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(10 * MAX_BACKOFF_MS));
    expect(fetchFn.mock.calls.length).toBeLessThanOrEqual(3 + 2 + 10); // never faster than the cap once backed off
  });

  it('pauses while the tab is hidden and polls at once when it becomes visible again', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok([progress()]));
    vi.stubGlobal('fetch', fetchFn);
    visibility = 'hidden';
    renderHook(() => useSyncProgress(INIT));
    await act(() => vi.advanceTimersByTimeAsync(5 * POLL_MS));
    expect(fetchFn).not.toHaveBeenCalled();
    visibility = 'visible';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('stops polling when the session is gone (401)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401 }));
    vi.stubGlobal('fetch', fetchFn);
    renderHook(() => useSyncProgress(INIT));
    await act(() => vi.advanceTimersByTimeAsync(10 * POLL_MS));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('stops polling when the proxy redirected the request to the login page', async () => {
    const redirected = new Response('<html></html>', { status: 200 });
    Object.defineProperty(redirected, 'redirected', { value: true });
    const fetchFn = vi.fn().mockResolvedValue(redirected);
    vi.stubGlobal('fetch', fetchFn);
    renderHook(() => useSyncProgress(INIT));
    await act(() => vi.advanceTimersByTimeAsync(10 * POLL_MS));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('aborts the in-flight request and stops scheduling when unmounted', async () => {
    let signal: AbortSignal | undefined;
    const fetchFn = vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_res, rej) => signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
    });
    vi.stubGlobal('fetch', fetchFn);
    const { unmount } = renderHook(() => useSyncProgress(INIT));
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(10 * POLL_MS);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('adopts fresher server data passed in after a refresh', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok([progress()])));
    const { result, rerender } = renderHook(({ init }) => useSyncProgress(init), { initialProps: { init: [progress({ percent: 10 })] } });
    rerender({ init: [progress({ percent: 77 })] });
    expect(result.current[0].percent).toBe(77);
  });
});
