import { describe, expect, it } from 'vitest';
import config from '@/next.config';

describe('frame headers', () => {
  it("every route may be framed by the app itself only: frame-ancestors 'self'", async () => {
    const rules = await config.headers!();
    const all = rules.find((r) => r.source === '/:path*');
    expect(all?.headers).toEqual([{ key: 'Content-Security-Policy', value: "frame-ancestors 'self'" }]);
    expect(rules.find((r) => r.source === '/sw.js')).toBeDefined(); // the worker's own headers stay
    expect(JSON.stringify(rules)).not.toMatch(/X-Frame-Options/i); // DENY would break the tabs; CSP is the one rule
  });
});
