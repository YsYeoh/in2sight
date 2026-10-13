import { describe, expect, it } from 'vitest';
import { isValidTimeZone } from '@/lib/prefs';
import { TIMEZONES, withCurrentZone } from '@/lib/timezones';

describe('timezones', () => {
  it('every listed zone is valid and the default zone is listed', () => {
    for (const z of TIMEZONES) expect(isValidTimeZone(z), z).toBe(true);
    expect(TIMEZONES).toContain('Asia/Kuala_Lumpur');
    expect(new Set(TIMEZONES).size).toBe(TIMEZONES.length);
  });

  it('withCurrentZone adds an unlisted current zone once, at the top, and leaves listed ones alone', () => {
    expect(withCurrentZone('Africa/Nairobi')[0]).toBe('Africa/Nairobi');
    expect(withCurrentZone('Africa/Nairobi')).toHaveLength(TIMEZONES.length + 1);
    expect(withCurrentZone('UTC')).toEqual([...TIMEZONES]);
  });
});
