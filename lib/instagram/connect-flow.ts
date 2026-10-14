import { normalizeGroup } from '@/lib/accounts/group';
import { connectAccount } from '@/lib/accounts/service';
import type { AccountsStore } from '@/lib/accounts/types';
import { exchangeCode, exchangeLongLived, fetchProfile, isProfessional, type IgConfig } from '@/lib/instagram/oauth';
import { verifyOAuthState } from '@/lib/instagram/state';

export interface CallbackInput { code: string | null; state: string | null; error: string | null; cookie: string | undefined }
export interface CallbackDeps { cfg: IgConfig; store: AccountsStore; fetchFn?: typeof fetch; now?: Date; /** best-effort hook after a successful save (e.g. clear the stale sync error) */ onConnected?: (accountId: string) => Promise<void> }

// redirects are fixed same-origin paths carrying an i18n error KEY, never prose or provider text
const to = (key: string) => ({ redirect: `/accounts?error=${key}` });

export async function processCallback(input: CallbackInput, deps: CallbackDeps): Promise<{ redirect: string }> {
  // 1. CSRF check first: a forged callback must cause no network call and no database access
  const st = verifyOAuthState(input.cookie, input.state);
  if (!st.ok) return to('state_mismatch');
  // 2. then the provider's own error (a denied consent), then the code
  if (input.error) return to('access_denied');
  if (!input.code) return to('missing_code');

  const fetchFn = deps.fetchFn ?? fetch;
  let token: { accessToken: string; expiresAt: string };
  try {
    const short = await exchangeCode(deps.cfg, input.code, fetchFn);
    token = await exchangeLongLived(deps.cfg, short.accessToken, fetchFn, deps.now);
  } catch {
    return to('exchange_failed');
  }

  let profile;
  try {
    profile = await fetchProfile(deps.cfg, token.accessToken, fetchFn);
  } catch {
    return to('profile_failed');
  }
  if (!isProfessional(profile.accountType)) return to('not_professional');

  const group = normalizeGroup(st.group);
  try {
    const { account } = await connectAccount(deps.store, {
      igUserId: profile.userId,
      username: profile.username,
      displayName: profile.name,
      accountType: profile.accountType,
      profilePictureUrl: profile.profilePictureUrl,
      groupName: group.ok && group.value !== null ? group.value : undefined, // undefined = keep an existing account's group
      accessToken: token.accessToken,
      expiresAt: token.expiresAt,
    });
    try {
      await deps.onConnected?.(account.id);
    } catch {
      // best-effort: never fails the connect
    }
  } catch {
    return to('save_failed');
  }
  return { redirect: `/accounts?connected=${encodeURIComponent(profile.username)}` };
}
