import { describe, expect, it } from 'vitest';
import { backHref, labQuery, parseLabParams, postLabHref } from '@/lib/post-lab/params';

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';

describe('Post Lab URL state', () => {
  it('defaults: 30 peers, engagement per reach, the default scope (no parameters)', () => {
    expect(parseLabParams({})).toEqual({ peers: 30, er: 'reach', scope: {} });
  });

  it('keeps only valid toggles and the canonical scope; hostile or repeated values fall back', () => {
    expect(parseLabParams({ peers: '90', er: 'followers', from: '90d', cmp: 'yoy' })).toEqual({ peers: 90, er: 'followers', scope: { from: '90d', cmp: 'yoy' } });
    expect(parseLabParams({ peers: ['90', '90'], er: "followers' or 1=1", from: '<script>', tab: 'x' })).toEqual({ peers: 30, er: 'reach', scope: {} });
  });

  it('links: into the Post Lab with the referring scope, toggles keep the scope, back goes to the right tab', () => {
    expect(postLabHref(A, '178', 'from=90d')).toBe(`/accounts/${A}/media/178?from=90d`);
    expect(postLabHref(A, '178')).toBe(`/accounts/${A}/media/178`);
    const p = parseLabParams({ from: '1y', peers: '90' });
    expect(labQuery(p)).toBe('from=1y&peers=90');
    expect(labQuery(p, { peers: 30, er: 'followers' })).toBe('from=1y&er=followers');
    expect(backHref(A, false, p)).toBe(`/accounts/${A}?tab=posts&from=1y`);
    expect(backHref(A, true, parseLabParams({}))).toBe(`/accounts/${A}?tab=stories`);
  });
});
