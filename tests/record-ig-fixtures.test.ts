import { describe, expect, it } from 'vitest';
import { plan, redact } from '../scripts/record-ig-fixtures.mjs';

describe('record-ig-fixtures', () => {
  it('redact removes the token everywhere, including paging URLs', () => {
    const body = { data: [{ id: '1' }], paging: { next: 'https://graph.instagram.com/v25.0/1/media?after=X&access_token=IGQ-abc&limit=2' }, echo: 'IGQ-abc' };
    const out = redact(body, 'IGQ-abc');
    expect(JSON.stringify(out)).not.toContain('IGQ-abc');
    expect(out.paging.next).toContain('access_token=REDACTED&limit=2');
    expect(out.data).toEqual([{ id: '1' }]);
  });

  it('plans the same calls the sync makes, adding media/story insights once ids are known', () => {
    expect(plan({}, 1, 2).map((c) => c[0])).toEqual(['me', 'account-day', 'account-follows', 'demographics-age-gender', 'online-followers', 'media-page-1', 'stories']);
    const full = plan({ media: 'm1', story: 's1' }, 1, 2);
    expect(full.map((c) => c[0]).slice(-3)).toEqual(['media-insights-feed', 'media-insights-story', 'story-navigation']);
    expect(full.find((c) => c[0] === 'account-day')?.[2]).toMatchObject({ metric_type: 'total_value', period: 'day', since: 1, until: 2 });
  });
});
