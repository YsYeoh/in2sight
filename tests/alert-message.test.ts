import { describe, expect, it } from 'vitest';
import { alertHref } from '@/lib/alerts/message';
import { DEFAULT_PREFS, type Prefs } from '@/lib/prefs';
import { pushMessage } from '@/lib/alerts/push-message';
import { ALERT_KINDS } from '@/lib/alerts/settings';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const P = (locale: Prefs['locale'], o: Partial<Prefs> = {}): Prefs => ({ ...DEFAULT_PREFS, locale, ...o });
const PAYLOAD = { username: 'cafe', days: 2, runs: 3, pct: 25, ratio: 2.6, postId: '1789' };

describe('alert messages', () => {
  it('every kind has a title and body in both catalogs', () => {
    for (const k of ALERT_KINDS) {
      expect(en.notifications.kinds[k].title, k).toBeTruthy();
      expect(zh.notifications.kinds[k].body, k).toBeTruthy();
    }
  });

  it('English push text fills every parameter, with plurals', () => {
    expect(pushMessage({ kind: 'token_expiring', accountId: A, payload: PAYLOAD }, P('en'))).toEqual({
      title: 'Instagram access expiring',
      body: '@cafe: access ends in 2 days. Reconnect to keep syncing.',
      url: '/accounts',
      tag: `token_expiring:${A}`,
    });
    expect(pushMessage({ kind: 'token_expiring', accountId: A, payload: { ...PAYLOAD, days: 1 } }, P('en')).body).toContain('in 1 day.');
    expect(pushMessage({ kind: 'reach_drop', accountId: A, payload: PAYLOAD }, P('en')).body).toBe('@cafe: reach over the last 7 days is down 25% vs the 7 days before.');
    expect(pushMessage({ kind: 'taking_off', accountId: A, payload: PAYLOAD }, P('en')).body).toBe('A post by @cafe has 2.6× its usual reach.');
  });

  it("numbers follow the owner's number format", () => {
    const eu = P('en', { numberFormat: '1.234,5' });
    expect(pushMessage({ kind: 'taking_off', accountId: A, payload: PAYLOAD }, eu).body).toBe('A post by @cafe has 2,6× its usual reach.');
    expect(pushMessage({ kind: 'taking_off', accountId: A, payload: PAYLOAD }, P('en')).body).toBe('A post by @cafe has 2.6× its usual reach.');
  });

  it('Chinese push text is Chinese, with the same parameters', () => {
    const m = pushMessage({ kind: 'sync_failing', accountId: A, payload: PAYLOAD }, P('zh-CN'));
    expect(m.title).toBe(zh.notifications.kinds.sync_failing.title);
    expect(m.body).toContain('@cafe');
    expect(m.body).toContain('3');
    expect(m.body).toMatch(/[一-鿿]/);
  });

  it('very long usernames are clipped to 40 characters in the text', () => {
    const long = 'x'.repeat(80);
    const m = pushMessage({ kind: 'needs_reconnect', accountId: A, payload: { username: long } }, P('en'));
    expect(m.body).toContain('@' + 'x'.repeat(39) + '…');
    expect(m.body).not.toContain('x'.repeat(41));
  });

  it('missing optional parameters never print "undefined" or NaN', () => {
    for (const k of ALERT_KINDS) {
      const m = pushMessage({ kind: k, accountId: A, payload: { username: 'cafe' } }, P('en'));
      expect(m.title + m.body, k).not.toMatch(/undefined|NaN|\{/);
    }
  });

  it('links stay on this site and point at the right place', () => {
    expect(alertHref('taking_off', A)).toBe(`/accounts/${A}?tab=posts`);
    expect(alertHref('reach_drop', A)).toBe(`/accounts/${A}`);
    expect(alertHref('needs_reconnect', A)).toBe('/accounts');
    expect(alertHref('token_expiring', null)).toBe('/overview');
  });
});
