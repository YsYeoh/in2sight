import { describe, expect, it } from 'vitest';
import { serverTiming, timed, type Span } from '@/lib/server-timing';

describe('serverTiming', () => {
  it('formats spans as a Server-Timing header value with one decimal', () => {
    expect(serverTiming([{ name: 'auth', dur: 12.345 }, { name: 'total', dur: 14 }])).toBe('auth;dur=12.3, total;dur=14.0');
  });

  it('empty list → empty string', () => {
    expect(serverTiming([])).toBe('');
  });

  it('strips anything that is not a header token from names (no injection of extra params or values)', () => {
    expect(serverTiming([{ name: 'a;desc="x", b', dur: 1 }])).toBe('adescxb;dur=1.0');
    expect(serverTiming([{ name: '"";,', dur: 1 }])).toBe('span;dur=1.0');
  });

  it('clamps negative, NaN and infinite durations to 0', () => {
    expect(serverTiming([{ name: 'a', dur: -3 }, { name: 'b', dur: Number.NaN }, { name: 'c', dur: Infinity }])).toBe('a;dur=0.0, b;dur=0.0, c;dur=0.0');
  });
});

describe('timed', () => {
  it('returns the result and records the duration', async () => {
    const spans: Span[] = [];
    let t = 100;
    const now = () => (t += 5);
    expect(await timed(spans, 'auth', async () => 'ok', now)).toBe('ok');
    expect(spans).toEqual([{ name: 'auth', dur: 5 }]);
  });

  it('records the span even when the work throws, and rethrows', async () => {
    const spans: Span[] = [];
    await expect(
      timed(spans, 'auth', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe('auth');
  });
});
