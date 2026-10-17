export const IG_SCOPES = ['instagram_business_basic', 'instagram_business_manage_insights', 'instagram_business_manage_comments'] as const;

/** Per request. Keeps one hung call from eating the tick's time budget. */
const IG_TIMEOUT_MS = 10_000;

export interface IgConfig { appId: string; appSecret: string; redirectUri: string; apiVersion: string }
export interface IgProfile { userId: string; username: string; name: string | null; accountType: string | null; profilePictureUrl: string | null }

type Kind = 'oauth' | 'token' | 'profile' | 'data' | 'network';
const MESSAGES: Record<Kind, string> = {
  oauth: 'instagram oauth failed',
  token: 'instagram token request failed',
  profile: 'instagram profile request failed',
  data: 'instagram data request failed',
  network: 'instagram request failed (network)',
};

/** Fixed message per kind: response bodies, tokens, codes and secrets never end up in an error. */
export class InstagramApiError extends Error {
  constructor(public kind: Kind, public status?: number, public code?: number, public subcode?: number) {
    super(MESSAGES[kind]);
    this.name = 'InstagramApiError';
  }
}

export function buildAuthorizeUrl(cfg: IgConfig, state: string): string {
  const u = new URL('https://www.instagram.com/oauth/authorize');
  u.searchParams.set('client_id', cfg.appId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', IG_SCOPES.join(','));
  u.searchParams.set('state', state);
  u.searchParams.set('force_reauth', 'true'); // show the login screen so each account can be chosen
  return u.toString();
}

export async function call(kind: Kind, fetchFn: typeof fetch, url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchFn(url, init);
  } catch {
    throw new InstagramApiError('network');
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // non-JSON body: fall through with the status only
  }
  if (!res.ok) {
    const err = body.error as { code?: unknown; error_subcode?: unknown } | undefined;
    const raw = typeof err === 'object' && err ? err.code : body.code;
    const sub = typeof err === 'object' && err ? err.error_subcode : undefined;
    throw new InstagramApiError(kind, res.status, typeof raw === 'number' ? raw : undefined, typeof sub === 'number' ? sub : undefined);
  }
  return body;
}

/**
 * The scopes Meta granted, from the code exchange's `permissions` (documented as one comma-separated string; an array
 * is accepted too). null = Meta did not say, which callers treat as "not granted" (never inferred from API answers).
 */
export function parseScopes(v: unknown): string[] | null {
  const list = typeof v === 'string' ? v.split(',') : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
  return list ? [...new Set(list.map((s) => s.trim()).filter(Boolean))] : null;
}

export async function exchangeCode(cfg: IgConfig, code: string, fetchFn: typeof fetch = fetch): Promise<{ accessToken: string; userId: string; grantedScopes: string[] | null }> {
  const body = await call('oauth', fetchFn, 'https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.appId, client_secret: cfg.appSecret, grant_type: 'authorization_code', redirect_uri: cfg.redirectUri, code }).toString(),
  });
  const first = (Array.isArray(body.data) ? (body.data as Record<string, unknown>[])[0] : body) ?? {};
  const token = first.access_token;
  const user = first.user_id;
  if (typeof token !== 'string' || token === '' || (typeof user !== 'string' && typeof user !== 'number')) throw new InstagramApiError('oauth');
  return { accessToken: token, userId: String(user), grantedScopes: parseScopes(first.permissions) };
}

function longLived(body: Record<string, unknown>, now: Date): { accessToken: string; expiresAt: string } {
  const token = body.access_token;
  const secs = body.expires_in;
  if (typeof token !== 'string' || token === '' || typeof secs !== 'number' || !(secs > 0)) throw new InstagramApiError('token');
  return { accessToken: token, expiresAt: new Date(now.getTime() + secs * 1000).toISOString() };
}

export async function exchangeLongLived(cfg: IgConfig, shortToken: string, fetchFn: typeof fetch = fetch, now: Date = new Date()) {
  const u = new URL('https://graph.instagram.com/access_token');
  u.searchParams.set('grant_type', 'ig_exchange_token');
  u.searchParams.set('client_secret', cfg.appSecret);
  u.searchParams.set('access_token', shortToken);
  return longLived(await call('token', fetchFn, u.toString()), now);
}

/** The token travels in the query string: time out, and never follow a redirect to another host. */
export const graphInit = (): RequestInit => ({ signal: AbortSignal.timeout(IG_TIMEOUT_MS), redirect: 'error' });

export async function refreshLongLived(accessToken: string, fetchFn: typeof fetch = fetch, now: Date = new Date(), init: RequestInit = graphInit()) {
  const u = new URL('https://graph.instagram.com/refresh_access_token');
  u.searchParams.set('grant_type', 'ig_refresh_token');
  u.searchParams.set('access_token', accessToken);
  return longLived(await call('token', fetchFn, u.toString(), init), now);
}

export async function fetchProfile(cfg: IgConfig, accessToken: string, fetchFn: typeof fetch = fetch): Promise<IgProfile> {
  const u = new URL(`https://graph.instagram.com/${cfg.apiVersion}/me`);
  u.searchParams.set('fields', 'user_id,username,name,account_type,profile_picture_url');
  u.searchParams.set('access_token', accessToken);
  const b = await call('profile', fetchFn, u.toString());
  const id = b.user_id;
  if ((typeof id !== 'string' && typeof id !== 'number') || typeof b.username !== 'string' || b.username === '') throw new InstagramApiError('profile');
  const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
  return { userId: String(id), username: b.username, name: str(b.name), accountType: str(b.account_type), profilePictureUrl: str(b.profile_picture_url) };
}

export function isProfessional(accountType: string | null): boolean {
  return accountType !== null && ['business', 'media_creator'].includes(accountType.toLowerCase());
}
