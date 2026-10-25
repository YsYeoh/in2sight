import { describe, expect, it } from 'vitest';
import { COMMENT_KEYS, commentHref, parseCommentState, type CommentState } from '@/lib/comments/state';
import { ALL_TIME, LIST_KEYS } from '@/lib/dashboard/lists';

const DEFAULT: CommentState = { section: 'comments', dates: ALL_TIME, q: '', media: null, only: null, fans: 'top', page: 1 };

describe('parseCommentState', () => {
  it('defaults: All comments, All time, no filters, top fans, page 1', () => expect(parseCommentState({})).toEqual(DEFAULT));

  it('reads every key', () => {
    expect(parseCommentState({ section: 'fans', pr: '30d', q: '  where   to buy ', media: '17895695668004550', only: 'questions', fans: 'quiet', page: '3' })).toEqual({
      section: 'fans',
      dates: { pr: '30d', from: null, to: null },
      q: 'where to buy',
      media: '17895695668004550',
      only: 'questions',
      fans: 'quiet',
      page: 3,
    });
    expect(parseCommentState({ pfrom: '2026-10-09', pto: '2026-10-01' }).dates).toEqual({ pr: null, from: '2026-10-01', to: '2026-10-09' }); // swapped into order
  });

  it('drops hostile or unknown values (never echoed)', () => {
    expect(
      parseCommentState({ section: 'admin', media: '12; drop table', only: 'all', fans: ['new', 'quiet'], page: '0', q: ['a', 'b'], pr: '7days' }),
    ).toEqual(DEFAULT);
    expect(parseCommentState({ media: '1'.repeat(33), page: '1e3' })).toEqual(DEFAULT);
    expect(parseCommentState({ q: 'x'.repeat(150) }).q).toHaveLength(100);
  });
});

describe('commentHref', () => {
  it('fixed order, defaults left out, page back to 1 on any change', () => {
    const s: CommentState = { ...DEFAULT, section: 'questions', dates: { pr: '7d', from: null, to: null }, q: 'price', media: '42', only: 'fans', page: 4 };
    expect(commentHref(s, {})).toBe('?tab=comments&section=questions&pr=7d&q=price&media=42&only=fans');
    expect(commentHref(s, { page: 5 })).toBe('?tab=comments&section=questions&pr=7d&q=price&media=42&only=fans&page=5');
    expect(commentHref(s, { section: 'comments', q: '', media: null, only: null, dates: ALL_TIME })).toBe('?tab=comments');
    expect(commentHref({ ...DEFAULT, section: 'fans' }, { fans: 'new' })).toBe('?tab=comments&section=fans&fans=new');
  });

  it('a section change keeps the other filters (rule 3) and custom dates win', () => {
    const s: CommentState = { ...DEFAULT, q: 'cake', dates: { pr: null, from: '2026-10-01', to: null } };
    expect(commentHref(s, { section: 'topics' })).toBe('?tab=comments&section=topics&pfrom=2026-10-01&q=cake');
  });

  it('the Time Scope rides along but never overrides the tab’s own params', () => {
    expect(commentHref({ ...DEFAULT, q: 'a b' }, {}, { from: '90d', q: 'evil', tab: 'posts' })).toBe('?tab=comments&q=a+b&from=90d');
  });

  it('its own keys are disjoint from the list keys (both are left out of the Suspense key)', () => {
    expect(COMMENT_KEYS.filter((k) => (LIST_KEYS as readonly string[]).includes(k))).toEqual([]);
    for (const k of ['pr', 'pfrom', 'pto', 'q', 'page']) expect(LIST_KEYS).toContain(k);
  });
});
