import { describe, expect, it } from 'vitest';
import { plan, redact, redactIdentity, sourcePath } from '../scripts/record-ig-fixtures.mjs';

describe('record-ig-fixtures', () => {
  it('redact removes the token everywhere, including paging URLs', () => {
    const body = { data: [{ id: '1' }], paging: { next: 'https://graph.instagram.com/v25.0/1/media?after=X&access_token=IGQ-abc&limit=2' }, echo: 'IGQ-abc' };
    const out = redact(body, 'IGQ-abc');
    expect(JSON.stringify(out)).not.toContain('IGQ-abc');
    expect(out.paging.next).toContain('access_token=REDACTED&limit=2');
    expect(out.data).toEqual([{ id: '1' }]);
  });

  it('redactIdentity swaps ids, captions, handles and URLs for stable placeholders but keeps structure, types and metric values', () => {
    const body = {
      data: [
        { id: '17900000000000001', caption: 'my secret launch', media_type: 'IMAGE', permalink: 'https://www.instagram.com/p/AbC/', timestamp: '2026-10-13T10:00:00+0000' },
        { id: '17900000000000002', caption: null, media_type: 'VIDEO', permalink: 'https://www.instagram.com/reel/XyZ/', timestamp: '2026-10-12T10:00:00+0000' },
      ],
      paging: { cursors: { before: 'QVFI', after: 'QVFJ' }, next: 'https://graph.instagram.com/v25.0/17841400000000001/media?fields=id&after=QVFJ&access_token=REDACTED' },
    };
    const out = redactIdentity(body);
    const s = JSON.stringify(out);
    for (const secret of ['17900000000000001', '17900000000000002', 'my secret launch', 'AbC', 'XyZ', '17841400000000001', 'QVFJ']) expect(s).not.toContain(secret);
    expect(out.data.map((m: { media_type: string }) => m.media_type)).toEqual(['IMAGE', 'VIDEO']);
    expect(out.data[1].caption).toBeNull();
    expect(out.data[0].timestamp).toBe('2026-10-13T10:00:00+0000');
    expect(typeof out.data[0].id).toBe('string');
    expect(out.data[0].id).not.toBe(out.data[1].id);
    expect(redactIdentity(body).data[0].id).toBe(out.data[0].id); // stable for the same input
    expect(out.data[0].permalink).toMatch(/^https:\/\/www\.instagram\.com\//);
  });

  it('redactIdentity keeps insight entries intact (metric names, numbers) and redacts profile fields', () => {
    const insight = { data: [{ name: 'reach', period: 'day', title: 'Accounts reached', id: '1784/insights/reach/day', total_value: { value: 1830 } }] };
    const out = redactIdentity(insight);
    expect(out.data[0]).toMatchObject({ name: 'reach', title: 'Accounts reached', total_value: { value: 1830 } });
    expect(out.data[0].id).not.toContain('1784');
    const me = redactIdentity({ user_id: 1784, id: '1784', username: 'brandx', name: 'Brand X', profile_picture_url: 'https://cdn/x.jpg', followers_count: 1520, media_count: 40 });
    expect(JSON.stringify(me)).not.toMatch(/brandx|Brand X|cdn\/x/);
    expect(me).toMatchObject({ followers_count: 1520, media_count: 40 });
    expect(typeof me.user_id).toBe('number');
    expect(me.user_id).not.toBe(1784);
  });

  it('sourcePath hides the media id in the recorded _source line', () => {
    expect(sourcePath('17900000000000001/insights')).toBe('{media-id}/insights');
    expect(sourcePath('me/insights')).toBe('me/insights');
  });

  it('plans the same calls the sync makes, adding media/story insights once ids are known', () => {
    expect(plan({}, 1, 2).map((c) => c[0])).toEqual(['me', 'account-day', 'account-follows', 'demographics-age-gender', 'online-followers', 'media-page-1', 'stories']);
    const full = plan({ media: 'm1', story: 's1' }, 1, 2);
    expect(full.map((c) => c[0]).slice(-3)).toEqual(['media-insights-feed', 'media-insights-story', 'story-navigation']);
    expect(full.find((c) => c[0] === 'account-day')?.[2]).toMatchObject({ metric_type: 'total_value', period: 'day', since: 1, until: 2 });
  });
});
