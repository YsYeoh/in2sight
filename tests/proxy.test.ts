// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = { sub: null as string | null, aal: 'aal1', next: 'aal1', setCookie: false, headers: {} as Record<string, string> };

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: { cookies: { setAll: (c: { name: string; value: string; options?: object }[], h: Record<string, string>) => void } },
  ) => ({
    auth: {
      getClaims: async () => {
        if (state.setCookie) opts.cookies.setAll([{ name: 'sb-refreshed', value: '1', options: { path: '/' } }], state.headers);
        return { data: state.sub ? { claims: { sub: state.sub, aal: state.aal, email: 'o@x.y' } } : null, error: null };
      },
      getUser: async () => ({ data: { user: { id: state.sub, factors: state.next === 'aal2' ? [{ status: 'verified' }] : [] } }, error: null }),
    },
  }),
}));

import { proxy, config } from '@/proxy';

const req = (path: string) => new NextRequest(new URL(path, 'https://app.test'));

beforeEach(() => {
  state.sub = null;
  state.aal = 'aal1';
  state.next = 'aal1';
  state.setCookie = false;
  state.headers = {};
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_1';
  delete process.env.NEXT_PUBLIC_APP_URL; // the proxy gate is URL + key only
});

describe('proxy', () => {
  it('sends an anonymous visitor to /login', async () => {
    const res = await proxy(req('/overview'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
  });

  it('lets a signed-in user through', async () => {
    state.sub = 'u1';
    const res = await proxy(req('/overview'));
    expect(res.headers.get('location')).toBeNull();
    expect(res.status).toBe(200);
  });

  it('sends a password-only session of a 2FA account to /login/verify', async () => {
    state.sub = 'u1';
    state.next = 'aal2';
    const res = await proxy(req('/settings'));
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login/verify');
  });

  it('lets a signed-in session with a pending 2FA code reach /auth/signout', async () => {
    state.sub = 'u1';
    state.next = 'aal2';
    const res = await proxy(req('/auth/signout'));
    expect(res.headers.get('location')).toBeNull();
    expect(res.status).toBe(200);
  });

  it('copies refreshed session cookies onto a redirect response', async () => {
    state.setCookie = true;
    const res = await proxy(req('/accounts'));
    expect(res.status).toBe(307);
    expect(res.cookies.get('sb-refreshed')?.value).toBe('1');
  });

  it('applies the no-store headers from setAll to both the pass-through and the redirect response', async () => {
    state.setCookie = true;
    state.headers = { 'cache-control': 'private, no-store' };
    const redirect = await proxy(req('/accounts'));
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get('cache-control')).toBe('private, no-store');

    state.sub = 'u1';
    const pass = await proxy(req('/overview'));
    expect(pass.status).toBe(200);
    expect(pass.headers.get('cache-control')).toBe('private, no-store');
  });

  it('without Supabase env it routes to /setup but still serves /styleguide', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const redirect = await proxy(req('/overview'));
    expect(new URL(redirect.headers.get('location')!).pathname).toBe('/setup');
    expect((await proxy(req('/styleguide'))).headers.get('location')).toBeNull();
    expect((await proxy(req('/setup'))).headers.get('location')).toBeNull();
  });

  it('never redirects to an external or caller-supplied location', async () => {
    const res = await proxy(req('/overview?next=https://evil.example'));
    expect(new URL(res.headers.get('location')!).origin).toBe('https://app.test');
  });
});

describe('matcher', () => {
  // path-to-regexp treats this pattern like a plain anchored RegExp
  const re = new RegExp('^' + config.matcher[0] + '$');
  it('runs the proxy for app routes, including look-alikes of the skipped files', () => {
    for (const path of ['/', '/overview', '/login', '/api/x', '/exports/png', '/api/foo-ico', '/offline-anything', '/swxjs', '/faviconxico', '/auth/signout']) {
      expect(re.test(path), path).toBe(true);
    }
  });

  it('skips static assets and PWA files', () => {
    for (const path of ['/logo.png', '/a/b.svg', '/_next/static/a.js', '/_next/image', '/favicon.ico', '/sw.js', '/offline', '/manifest.webmanifest']) {
      expect(re.test(path), path).toBe(false);
    }
  });

  it('is a single matcher', () => {
    expect(config.matcher.length).toBe(1);
  });
});
