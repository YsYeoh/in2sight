import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';

function flatten(o: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object') Object.assign(out, flatten(v as Record<string, unknown>, key));
    else out[key] = String(v);
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort().join(',');

const fe = flatten(en);
const fz = flatten(zh);

describe('message catalogs', () => {
  it('zh-CN has exactly the same keys as en (nothing missing, nothing stale)', () => {
    expect(Object.keys(fz).sort()).toEqual(Object.keys(fe).sort());
  });

  it('no message is empty', () => {
    for (const [k, v] of Object.entries(fe)) expect(v.trim(), `en ${k}`).not.toBe('');
    for (const [k, v] of Object.entries(fz)) expect(v.trim(), `zh-CN ${k}`).not.toBe('');
  });

  it('{placeholders} match between locales for every key', () => {
    for (const k of Object.keys(fe)) expect(placeholders(fz[k] ?? ''), `placeholders of ${k}`).toBe(placeholders(fe[k]));
  });

  it('zh-CN actually differs from en for translatable text (guards against copy-pasted English)', () => {
    const same = Object.keys(fe).filter((k) => fe[k] === fz[k] && /[A-Za-z]{4,}/.test(fe[k]));
    expect(same, `untranslated keys: ${same.join(', ')}`).toEqual([]);
  });

  it('zh-CN setup strings use full-width punctuation', () => {
    for (const [k, v] of Object.entries(fz)) if (k.startsWith('setup.')) expect(v, k).not.toMatch(/[():]/);
  });

  it('both recovery hints point to the auth runbook', () => {
    expect(fe['settings.twoFactor.recovery']).toContain('docs/RUNBOOK_AUTH.md');
    expect(fz['settings.twoFactor.recovery']).toContain('docs/RUNBOOK_AUTH.md');
  });
});
