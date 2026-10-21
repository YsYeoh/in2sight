import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import type { Kpi } from '@/lib/analysis/growth';
import { formatDay, formatSigned, type FormatPrefs } from '@/lib/format';
import { deltaView, formatMetric, METRICS } from '@/lib/metrics';

const P: FormatPrefs = { locale: 'en', dateFormat: 'D MMM YYYY', timeFormat: '24h', numberFormat: '1,234.5', timezone: 'Asia/Kuala_Lumpur' };
const k = (o: Partial<Kpi>): Kpi => ({ value: 1, prior: 1, diff: 0, change: 0, reason: null, ...o });

describe('METRICS registry', () => {
  it('every metric has a label in both languages', () => {
    for (const id of Object.keys(METRICS)) {
      expect((en.metrics as Record<string, string>)[id], id).toBeTruthy();
      expect((zh.metrics as Record<string, string>)[id], id).toBeTruthy();
    }
  });
});

describe('formatMetric', () => {
  it('compact counts, full counts, percents', () => {
    expect(formatMetric('reach', 12345, P)).toBe('12.3K');
    expect(formatMetric('followers', 12345, P, { full: true })).toBe('12,345');
    expect(formatMetric('engagementRate', 0.0456, P)).toBe('4.6%');
    expect(formatMetric('reach', null, P)).toBe('—');
  });
});

describe('deltaView', () => {
  it('relative change for counts, coloured by higher-is-better', () => {
    expect(deltaView('reach', k({ diff: 50, change: 0.125 }), P)).toEqual({ text: '+12.5%', unit: 'relative', direction: 'up', tone: 'good' });
    expect(deltaView('reach', k({ diff: -50, change: -0.125 }), P)).toMatchObject({ text: '-12.5%', direction: 'down', tone: 'bad' });
  });
  it('percentage points for rates', () => {
    expect(deltaView('engagementRate', k({ diff: 0.004, change: 0.1 }), P)).toEqual({ text: '+0.4', unit: 'points', direction: 'up', tone: 'good' });
  });
  it('absolute change when the previous value was 0; flat is neutral; nothing to compare is null', () => {
    expect(deltaView('posts', k({ diff: 3, change: null }), P)).toEqual({ text: '+3', unit: 'absolute', direction: 'up', tone: 'good' });
    expect(deltaView('reach', k({ diff: 0.0001, change: 0.0000001 }), P)).toMatchObject({ text: '0.0%', direction: 'flat', tone: 'neutral' });
    expect(deltaView('reach', k({ diff: null, change: null }), P)).toBeNull();
  });
  it('takes a { kind, higherIsBetter } definition for numbers outside the registry (lower-is-better turns a rise bad)', () => {
    expect(deltaView({ kind: 'count', higherIsBetter: false }, k({ diff: 5, change: 0.5 }), P)).toEqual({ text: '+50.0%', unit: 'relative', direction: 'up', tone: 'bad' });
    expect(deltaView({ kind: 'percent', higherIsBetter: false }, k({ diff: -0.01, change: -0.2 }), P)).toEqual({ text: '-1.0', unit: 'points', direction: 'down', tone: 'good' });
    expect(deltaView({ kind: 'count', higherIsBetter: true }, k({ diff: null }), P)).toBeNull();
  });
});

describe('formatDay / formatSigned', () => {
  it('formats a calendar day without shifting it by the timezone', () => {
    expect(formatDay('2026-10-14', { ...P, timezone: 'Pacific/Kiritimati' })).toBe('14 Oct 2026');
    expect(formatDay('2026-10-14', { ...P, timezone: 'Pacific/Pago_Pago' })).toBe('14 Oct 2026');
    expect(formatDay('nonsense', P)).toBe('—');
  });
  it('signs absolute changes, never a signed zero', () => {
    expect(formatSigned(1234, P)).toBe('+1,234');
    expect(formatSigned(-3.25, P, 1)).toBe('-3.3');
    expect(formatSigned(-0.01, P)).toBe('0');
    expect(formatSigned(null, P)).toBe('—');
  });
});
