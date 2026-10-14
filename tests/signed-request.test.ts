// @vitest-environment node
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseSignedRequest } from '@/lib/instagram/signed-request';

const SECRET = 'app-secret-123';
const b64u = (s: string | Buffer) => Buffer.from(s).toString('base64url');
function sign(payload: object, secret = SECRET) {
  const p = b64u(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(p).digest('base64url');
  return `${sig}.${p}`;
}

describe('parseSignedRequest', () => {
  it('accepts a correctly signed request and returns the user id as a string', () => {
    expect(parseSignedRequest(sign({ algorithm: 'HMAC-SHA256', user_id: 1784, issued_at: 1 }), SECRET)).toEqual({ userId: '1784' });
    expect(parseSignedRequest(sign({ algorithm: 'hmac-sha256', user_id: 'abc' }), SECRET)).toEqual({ userId: 'abc' });
  });

  it('rejects a wrong secret and a tampered payload', () => {
    expect(parseSignedRequest(sign({ algorithm: 'HMAC-SHA256', user_id: '1' }, 'other'), SECRET)).toBeNull();
    const good = sign({ algorithm: 'HMAC-SHA256', user_id: '1' });
    const [sig] = good.split('.');
    const forged = `${sig}.${b64u(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '999' }))}`;
    expect(parseSignedRequest(forged, SECRET)).toBeNull();
  });

  it('rejects other algorithms and missing user ids even when correctly signed', () => {
    expect(parseSignedRequest(sign({ algorithm: 'HMAC-SHA1', user_id: '1' }), SECRET)).toBeNull();
    expect(parseSignedRequest(sign({ user_id: '1' }), SECRET)).toBeNull();
    expect(parseSignedRequest(sign({ algorithm: 'HMAC-SHA256' }), SECRET)).toBeNull();
    expect(parseSignedRequest(sign({ algorithm: 'HMAC-SHA256', user_id: '' }), SECRET)).toBeNull();
    expect(parseSignedRequest(sign({ algorithm: 'HMAC-SHA256', user_id: { a: 1 } }), SECRET)).toBeNull();
  });

  it('rejects malformed input without throwing', () => {
    for (const bad of ['', 'nodot', 'a.b.c', '.', 'a.', '.b', '%%%.%%%', sign({ algorithm: 'HMAC-SHA256', user_id: '1' }) + 'x'])
      expect(parseSignedRequest(bad, SECRET), bad).toBeNull();
    expect(parseSignedRequest(`${b64u('x')}.${b64u('not json')}`, SECRET)).toBeNull();
    expect(parseSignedRequest(sign({ algorithm: 'HMAC-SHA256', user_id: '1' }), '')).toBeNull(); // empty secret never validates
  });

  it('does not accept a signature of the wrong length (timingSafeEqual would throw)', () => {
    const p = b64u(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '1' }));
    expect(parseSignedRequest(`short.${p}`, SECRET)).toBeNull();
  });
});
