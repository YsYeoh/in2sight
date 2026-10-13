# Instagram Connect & Accounts Implementation Plan (Plan 4 of 8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect Instagram professional accounts through Instagram's own login (OAuth), store each account's long-lived token server-side, and manage accounts in the app: list with status and token expiry, optional groups, archive / restore / permanent delete, reconnect, and the Meta-required deauthorize / data-deletion callbacks.

**Architecture:** All business rules live in pure modules over small interfaces (`AccountsStore`, an injectable `fetch`), unit-tested with in-memory fakes and mocked HTTP. Thin glue — route handlers, server actions, a Supabase-backed store — wires them to Next and Supabase. Mutations use the server-only admin client **after** an owner check; reads for the page use the owner's session (row-level security). Nothing here needs a live Meta app or Supabase project to be built and tested; live behaviour is verified by a runbook once the owner's app and project exist.

**Tech Stack:** Next.js 16 route handlers + server actions, `@supabase/supabase-js`, Node `crypto` (HMAC, `timingSafeEqual`), the Plan 2 UI kit, next-intl, Vitest. **No new dependencies.**

**Spec:** `docs/SPEC.md` §3 (Meta API approach), §5 (accounts, account_tokens), §7b/§7c (groups, remove = archive), §9. Meta facts below were checked against Meta's docs on 2026-10-14 (see `docs/META_SETUP.md` sources). Visual reference: `docs/mockups/app-prototype.html` (Accounts page + connect dialog), `docs/mockups/kit-data.html` (account list).

## Global Constraints

- **Instagram API with Instagram Login.** Authorization window: `https://www.instagram.com/oauth/authorize` with `client_id`, `redirect_uri`, `response_type=code`, `scope` (comma-separated), `state`, and `force_reauth=true` (so each account's own login is shown, enabling multi-account). Scopes **exactly** `instagram_business_basic,instagram_business_manage_insights`.
- Code → short-lived token: `POST https://api.instagram.com/oauth/access_token` (form-encoded `client_id`, `client_secret`, `grant_type=authorization_code`, `redirect_uri`, `code`). Short → long-lived (60 days): `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=…&access_token=…`. Refresh: `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=…`. Profile: `GET https://graph.instagram.com/{version}/me?fields=user_id,username,name,account_type,profile_picture_url&access_token=…` (`{version}` = `IG_API_VERSION`, default `v25.0`). `account_type` is `Business` or `Media_Creator` for professional accounts (compare case-insensitively; anything else, including personal, is rejected).
- Secrets: `IG_APP_SECRET`, access tokens and the OAuth `code` never appear in logs, URLs we generate, error messages, redirects or client bundles. The secret is referenced only inside `lib/env.ts`; tokens only inside `lib/accounts/` store code and the OAuth module. The `account_tokens` table is unreachable for the owner's browser session (explicit deny policy).
- OAuth `state` is a random value stored in an httpOnly cookie and compared in constant time; the callback accepts a code only when the state matches.
- Owner-only: every route handler and server action first checks the session (`getSessionInfo`: signed in, and aal2 if the account has 2FA) and answers 401 / `{ ok: false, error: 'unauthorized' }` otherwise. The Meta callbacks (`deauthorize`, `delete`) instead verify Meta's `signed_request` HMAC.
- SQL rules from Plan 3 apply (RLS on every table with ≥ 1 policy, `to authenticated` only, `(select auth.uid())`, `set search_path` on definer functions); `tests/migrations.test.ts` must stay green.
- Every UI string through next-intl, keys in BOTH catalogs (Simplified Chinese), parity test green. Components from `components/ui/*` and `components/shared/*`; semantic tokens only; responsive at 360/768/1280; dates via `lib/format.ts`.
- Commits conventional with trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (second `-m`). Windows Git Bash; **never kill processes by image name**; servers only on a specific port, stop only that PID. Use `git add` on specific paths (or check `git status` first) — never sweep up unrelated files.
- Branch: `feat/instagram-accounts` (from `main` after Plan 3 is merged).

## Review Focus

1. **OAuth CSRF / replay:** a callback with a missing, wrong, reused or expired `state` must not touch the database or call Instagram; the state cookie is cleared after use. *(Tasks 5-6)*
2. **Personal / non-professional accounts and denied consent:** `error=access_denied`, a profile whose `account_type` is not Business/Media_Creator, and a token response lacking a user id must end in a friendly `/accounts?error=…` with **nothing saved**. *(Task 6)*
3. **Reconnect and archive semantics:** reconnecting an archived account restores the *same* row (history keeps its id), keeps its group unless a new one is chosen, and never duplicates by `ig_user_id`; archived accounts are never silently resurrected by a deauthorize callback; permanent delete only works on archived accounts. *(Tasks 2-3)*
4. **Secret leakage:** no token/secret/code in any error message, redirect URL or thrown error text, including when Instagram's error body echoes something. *(Tasks 4-6)*
5. **Meta callbacks:** forged, tampered, wrong-algorithm or malformed `signed_request` values are rejected with 4xx and change nothing. *(Tasks 5-6)*
6. **Hostile group names:** control characters, over-long values, whitespace-only values, and HTML are handled (stored as plain text, rendered escaped by React, length-capped). *(Tasks 2, 7)*

---

## File Structure

```
supabase/migrations/20261014000002_accounts.sql     # accounts, account_tokens (+ deny policy)
lib/accounts/group.ts                                # normalizeGroup
lib/accounts/token-status.ts                         # tokenStatus
lib/accounts/types.ts                                # Account, StoredAccount, AccountsStore
lib/accounts/service.ts                              # connect/archive/restore/delete/setGroup/markNeedsReconnect
lib/accounts/supabase-store.ts                       # AccountsStore over Supabase
lib/instagram/oauth.ts                               # authorize URL, token exchange, refresh, profile
lib/instagram/state.ts                               # state cookie helpers
lib/instagram/signed-request.ts                      # Meta signed_request parser
lib/instagram/connect-flow.ts                        # processCallback (pure orchestration)
lib/auth/assert-owner.ts                             # assertOwner() for routes/actions
app/api/instagram/{connect,callback,deauthorize,delete}/route.ts
app/(app)/accounts/{page.tsx,actions.ts}
components/accounts/{AccountsView,ConnectDialog,StatusBadge,TokenMeter,GroupDialog}.tsx
tests/                                               # per module
docs/RUNBOOK_META.md                                 # live verification
```

---

### Task 1: `accounts` + `account_tokens` migration

**Files:**
- Create: `supabase/migrations/20261014000002_accounts.sql`
- Modify: `tests/migrations.test.ts` (add the assertions below)

**Interfaces:** Produces tables `public.accounts` and `public.account_tokens` (columns below) used by Tasks 3-7.

- [ ] **Step 1: Extend the lint test (RED).** Append to `tests/migrations.test.ts`:

```ts
describe('accounts migration', () => {
  const accounts = all;

  it('creates accounts with the columns the app relies on', () => {
    for (const col of ['ig_user_id', 'username', 'display_name', 'account_type', 'profile_picture_url', 'group_name', 'status', 'archived_at', 'last_error', 'token_expires_at', 'connected_at'])
      expect(accounts, col).toMatch(new RegExp(`\\b${col}\\b`));
    expect(accounts).toMatch(/ig_user_id\s+text\s+not\s+null\s+unique/i);
    expect(accounts).toMatch(/status\s+in\s*\(\s*'active'\s*,\s*'needs_reconnect'\s*,\s*'archived'\s*\)/i);
    expect(accounts).toMatch(/char_length\(group_name\)\s+between\s+1\s+and\s+40/i);
  });

  it('account_tokens is invisible to the owner browser session: an explicit deny-all policy', () => {
    expect(accounts).toMatch(/create\s+policy\s+\w+\s+on\s+public\.account_tokens[\s\S]*?using\s*\(\s*false\s*\)[\s\S]*?with\s+check\s*\(\s*false\s*\)/i);
    expect(accounts).not.toMatch(/create\s+policy\s+\w+\s+on\s+public\.account_tokens[\s\S]*?using\s*\(\s*true\s*\)/i);
  });

  it('the accounts policy gates on is_owner()', () => {
    expect(accounts).toMatch(/create\s+policy\s+accounts_owner_all\s+on\s+public\.accounts[\s\S]*?public\.is_owner\(\)/i);
  });

  it('tokens cascade away with their account', () => {
    expect(accounts).toMatch(/account_id\s+uuid\s+primary\s+key\s+references\s+public\.accounts\s*\(id\)\s+on\s+delete\s+cascade/i);
  });
});
```

Run `npx vitest run tests/migrations.test.ts` → the new tests FAIL (columns not present).

- [ ] **Step 2: Write the migration** — `supabase/migrations/20261014000002_accounts.sql`

```sql
-- Instagram accounts the owner has connected. group_name NULL = isolated account (no group).
create table public.accounts (
  id                  uuid primary key default gen_random_uuid(),
  ig_user_id          text not null unique,
  username            text not null,
  display_name        text,
  account_type        text,
  profile_picture_url text,
  group_name          text check (group_name is null or char_length(group_name) between 1 and 40),
  status              text not null default 'active' check (status in ('active', 'needs_reconnect', 'archived')),
  archived_at         timestamptz,
  last_error          text,
  token_expires_at    timestamptz,                 -- non-secret copy of the token expiry, readable by the owner session
  connected_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  check ((status = 'archived') = (archived_at is not null))
);
alter table public.accounts enable row level security;

create policy accounts_owner_all on public.accounts
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- Access tokens: written/read only with the secret (service-role) key, never by a browser session.
create table public.account_tokens (
  account_id   uuid primary key references public.accounts (id) on delete cascade,
  access_token text not null,
  expires_at   timestamptz not null,
  refreshed_at timestamptz not null default now()
);
alter table public.account_tokens enable row level security;

create policy account_tokens_deny_all on public.account_tokens
  for all to authenticated
  using (false)
  with check (false);
```

- [ ] **Step 3: Run to verify pass** — `npx vitest run tests/migrations.test.ts` → PASS (Plan 3's generic checks run over this file too).

- [ ] **Step 4: Verify and commit**

Run: `npm run lint && npm run typecheck && npm test`.

```bash
git add supabase/migrations/20261014000002_accounts.sql tests/migrations.test.ts
git commit -m "feat(db): accounts and account_tokens tables with owner RLS and a deny-all token policy" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Account rules — groups, token status, lifecycle service

**Files:**
- Create: `lib/accounts/group.ts`, `lib/accounts/token-status.ts`, `lib/accounts/types.ts`, `lib/accounts/service.ts`, `tests/group.test.ts`, `tests/token-status.test.ts`, `tests/accounts-service.test.ts`

**Interfaces:**
- Produces:

```ts
// types.ts
export type AccountStatus = 'active' | 'needs_reconnect' | 'archived';
export interface StoredAccount {
  id: string; igUserId: string; username: string; displayName: string | null; accountType: string | null;
  profilePictureUrl: string | null; groupName: string | null; status: AccountStatus; archivedAt: string | null;
  lastError: string | null; tokenExpiresAt: string | null; connectedAt: string;
}
export interface NewAccount { igUserId: string; username: string; displayName: string | null; accountType: string | null; profilePictureUrl: string | null; groupName: string | null; tokenExpiresAt: string }
export type AccountPatch = Partial<Omit<StoredAccount, 'id' | 'igUserId' | 'connectedAt'>>;
export interface AccountsStore {
  list(): Promise<StoredAccount[]>;
  getById(id: string): Promise<StoredAccount | null>;
  findByIgUserId(igUserId: string): Promise<StoredAccount | null>;
  insert(a: NewAccount): Promise<StoredAccount>;
  update(id: string, patch: AccountPatch): Promise<StoredAccount>;
  saveToken(accountId: string, token: { accessToken: string; expiresAt: string }): Promise<void>;
  remove(id: string): Promise<void>;
}
```

  - `normalizeGroup(raw: unknown): { ok: true; value: string | null } | { ok: false }` — trims and collapses inner whitespace; empty/whitespace-only/`null`/`undefined` → `{ ok: true, value: null }`; > 40 characters (after normalising, counted in Unicode code points) or any control character (`\u0000-\u001f`, `\u007f`) → `{ ok: false }`; non-strings → `{ ok: false }`. HTML is allowed as plain text (React escapes it on render).
  - `tokenStatus(expiresAt: string | Date | null | undefined, now: Date): { state: 'ok' | 'expiring' | 'expired' | 'unknown'; daysLeft: number }` — `unknown` for missing/invalid; `expired` when `expiresAt <= now`; `expiring` when ≤ 7 whole days remain; `daysLeft` is `Math.ceil` of the remaining days, never negative.
  - `connectAccount(store, input: { igUserId; username; displayName?; accountType?; profilePictureUrl?; groupName?: string | null | undefined; accessToken; expiresAt: string }): Promise<{ account: StoredAccount; outcome: 'created' | 'updated' | 'restored' }>` — new → insert (status active, `groupName ?? null`); existing archived → same row, status `active`, `archivedAt: null`, `lastError: null` (**outcome `restored`**); existing other → refresh profile fields, status `active`, `lastError: null` (**`updated`**). `groupName === undefined` keeps the existing group; `null` or a string sets it. The token is always saved with `saveToken`. Never inserts a second row for the same `igUserId`.
  - `archiveAccount(store, id)`, `restoreAccount(store, id)`: `{ ok: true } | { ok: false; error: 'not_found' | 'not_archived' }` (archive is idempotent: archiving an archived account is `ok`; restore on a non-archived account → `not_archived`; restore sets status `active`, clears `archivedAt`).
  - `deleteAccountPermanently(store, id)`: `{ ok: true } | { ok: false; error: 'not_found' | 'not_archived' }` — only archived accounts can be deleted.
  - `setAccountGroup(store, id, raw)`: `{ ok: true } | { ok: false; error: 'not_found' | 'invalid_group' }`.
  - `markNeedsReconnect(store, igUserId, reason)`: no-op for unknown or archived accounts; otherwise status `needs_reconnect`, `lastError: reason` (truncated to 200 chars).

- [ ] **Step 1: Write the failing tests**

`tests/group.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeGroup } from '@/lib/accounts/group';

describe('normalizeGroup', () => {
  it('trims and collapses inner whitespace', () => {
    expect(normalizeGroup('  Brand   X ')).toEqual({ ok: true, value: 'Brand X' });
  });
  it('empty, whitespace-only, null and undefined mean "no group"', () => {
    for (const v of ['', '   ', null, undefined]) expect(normalizeGroup(v), String(v)).toEqual({ ok: true, value: null });
  });
  it('accepts exactly 40 characters, rejects 41, counting code points not UTF-16 units', () => {
    expect(normalizeGroup('a'.repeat(40))).toEqual({ ok: true, value: 'a'.repeat(40) });
    expect(normalizeGroup('a'.repeat(41))).toEqual({ ok: false });
    expect(normalizeGroup('😀'.repeat(40))).toEqual({ ok: true, value: '😀'.repeat(40) });
    expect(normalizeGroup('😀'.repeat(41))).toEqual({ ok: false });
  });
  it('rejects control characters', () => {
    for (const v of ['a\u0000b', 'a\u001fb', 'a\u007fb']) expect(normalizeGroup(v), JSON.stringify(v)).toEqual({ ok: false });
  });
  it('a tab or newline is whitespace, not a control rejection: it collapses', () => {
    expect(normalizeGroup('a\tb\nc')).toEqual({ ok: true, value: 'a b c' });
  });
  it('rejects non-strings', () => {
    for (const v of [42, {}, [], true]) expect(normalizeGroup(v as never), String(v)).toEqual({ ok: false });
  });
  it('keeps HTML as inert text and Chinese names intact', () => {
    expect(normalizeGroup('<b>x</b>')).toEqual({ ok: true, value: '<b>x</b>' });
    expect(normalizeGroup('品牌甲')).toEqual({ ok: true, value: '品牌甲' });
  });
});
```

`tests/token-status.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { tokenStatus } from '@/lib/accounts/token-status';

const now = new Date('2026-10-14T00:00:00Z');
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();

describe('tokenStatus', () => {
  it('ok when more than 7 days remain', () => {
    expect(tokenStatus(inDays(54), now)).toEqual({ state: 'ok', daysLeft: 54 });
    expect(tokenStatus(inDays(8), now).state).toBe('ok');
  });
  it('expiring at 7 days or fewer', () => {
    expect(tokenStatus(inDays(7), now)).toEqual({ state: 'expiring', daysLeft: 7 });
    expect(tokenStatus(inDays(0.2), now)).toEqual({ state: 'expiring', daysLeft: 1 });
  });
  it('expired at or after the expiry instant; daysLeft never negative', () => {
    expect(tokenStatus(inDays(0), now)).toEqual({ state: 'expired', daysLeft: 0 });
    expect(tokenStatus(inDays(-3), now)).toEqual({ state: 'expired', daysLeft: 0 });
  });
  it('unknown for missing or unparsable values', () => {
    for (const v of [null, undefined, 'not a date', '']) expect(tokenStatus(v as never, now)).toEqual({ state: 'unknown', daysLeft: 0 });
  });
  it('accepts a Date', () => {
    expect(tokenStatus(new Date(inDays(30)), now).state).toBe('ok');
  });
});
```

`tests/accounts-service.test.ts` — an in-memory store plus the rules:

```ts
import { describe, expect, it } from 'vitest';
import type { AccountPatch, AccountsStore, NewAccount, StoredAccount } from '@/lib/accounts/types';
import { archiveAccount, connectAccount, deleteAccountPermanently, markNeedsReconnect, restoreAccount, setAccountGroup } from '@/lib/accounts/service';

function memoryStore() {
  const rows = new Map<string, StoredAccount>();
  const tokens = new Map<string, { accessToken: string; expiresAt: string }>();
  let n = 0;
  const store: AccountsStore = {
    list: async () => [...rows.values()],
    getById: async (id) => rows.get(id) ?? null,
    findByIgUserId: async (ig) => [...rows.values()].find((r) => r.igUserId === ig) ?? null,
    insert: async (a: NewAccount) => {
      const row: StoredAccount = { id: `a${++n}`, ...a, status: 'active', archivedAt: null, lastError: null, connectedAt: '2026-10-14T00:00:00Z' };
      rows.set(row.id, row);
      return row;
    },
    update: async (id, patch: AccountPatch) => {
      const next = { ...rows.get(id)!, ...patch };
      rows.set(id, next);
      return next;
    },
    saveToken: async (id, t) => void tokens.set(id, t),
    remove: async (id) => void (rows.delete(id), tokens.delete(id)),
  };
  return { store, rows, tokens };
}

const input = { igUserId: '1784', username: 'brandx', displayName: 'Brand X', accountType: 'Media_Creator', profilePictureUrl: null, accessToken: 'tok1', expiresAt: '2026-12-13T00:00:00Z' };

describe('connectAccount', () => {
  it('creates a new active account with its token', async () => {
    const { store, tokens } = memoryStore();
    const r = await connectAccount(store, { ...input, groupName: 'Brand X' });
    expect(r.outcome).toBe('created');
    expect(r.account).toMatchObject({ igUserId: '1784', username: 'brandx', status: 'active', groupName: 'Brand X', tokenExpiresAt: '2026-12-13T00:00:00Z' });
    expect(tokens.get(r.account.id)).toEqual({ accessToken: 'tok1', expiresAt: '2026-12-13T00:00:00Z' });
  });

  it('a new account without a group is isolated (null)', async () => {
    const { store } = memoryStore();
    expect((await connectAccount(store, input)).account.groupName).toBeNull();
  });

  it('connecting again updates the same row and token, never duplicating by ig_user_id', async () => {
    const { store, rows, tokens } = memoryStore();
    const first = await connectAccount(store, { ...input, groupName: 'G' });
    const again = await connectAccount(store, { ...input, username: 'brandx_new', accessToken: 'tok2' });
    expect(again.outcome).toBe('updated');
    expect(again.account.id).toBe(first.account.id);
    expect(rows.size).toBe(1);
    expect(again.account.username).toBe('brandx_new');
    expect(again.account.groupName).toBe('G'); // undefined group keeps the existing one
    expect(tokens.get(first.account.id)?.accessToken).toBe('tok2');
  });

  it('an explicit null group isolates an account, a string regroups it', async () => {
    const { store } = memoryStore();
    await connectAccount(store, { ...input, groupName: 'G' });
    expect((await connectAccount(store, { ...input, groupName: null })).account.groupName).toBeNull();
    expect((await connectAccount(store, { ...input, groupName: 'H' })).account.groupName).toBe('H');
  });

  it('reconnecting an archived account restores the SAME row, clears the error, keeps history identity', async () => {
    const { store, rows } = memoryStore();
    const first = await connectAccount(store, { ...input, groupName: 'G' });
    await archiveAccount(store, first.account.id);
    await store.update(first.account.id, { lastError: 'old' });
    const again = await connectAccount(store, input);
    expect(again.outcome).toBe('restored');
    expect(again.account).toMatchObject({ id: first.account.id, status: 'active', archivedAt: null, lastError: null, groupName: 'G' });
    expect(rows.size).toBe(1);
  });

  it('reconnecting a needs_reconnect account makes it active again', async () => {
    const { store } = memoryStore();
    const first = await connectAccount(store, input);
    await markNeedsReconnect(store, '1784', 'token revoked');
    const again = await connectAccount(store, input);
    expect(again.outcome).toBe('updated');
    expect(again.account).toMatchObject({ id: first.account.id, status: 'active', lastError: null });
  });
});

describe('archive / restore / delete', () => {
  it('archive hides the account but keeps the row; idempotent', async () => {
    const { store, rows } = memoryStore();
    const { account } = await connectAccount(store, input);
    expect(await archiveAccount(store, account.id)).toEqual({ ok: true });
    expect(rows.get(account.id)).toMatchObject({ status: 'archived' });
    expect(rows.get(account.id)!.archivedAt).toBeTruthy();
    expect(await archiveAccount(store, account.id)).toEqual({ ok: true });
  });

  it('unknown ids are not_found', async () => {
    const { store } = memoryStore();
    expect(await archiveAccount(store, 'zzz')).toEqual({ ok: false, error: 'not_found' });
    expect(await restoreAccount(store, 'zzz')).toEqual({ ok: false, error: 'not_found' });
    expect(await deleteAccountPermanently(store, 'zzz')).toEqual({ ok: false, error: 'not_found' });
    expect(await setAccountGroup(store, 'zzz', 'G')).toEqual({ ok: false, error: 'not_found' });
  });

  it('restore only works on archived accounts', async () => {
    const { store, rows } = memoryStore();
    const { account } = await connectAccount(store, input);
    expect(await restoreAccount(store, account.id)).toEqual({ ok: false, error: 'not_archived' });
    await archiveAccount(store, account.id);
    expect(await restoreAccount(store, account.id)).toEqual({ ok: true });
    expect(rows.get(account.id)).toMatchObject({ status: 'active', archivedAt: null });
  });

  it('permanent delete refuses anything that is not archived, and removes row + token when archived', async () => {
    const { store, rows, tokens } = memoryStore();
    const { account } = await connectAccount(store, input);
    expect(await deleteAccountPermanently(store, account.id)).toEqual({ ok: false, error: 'not_archived' });
    expect(rows.size).toBe(1);
    await markNeedsReconnect(store, '1784', 'x');
    expect(await deleteAccountPermanently(store, account.id)).toEqual({ ok: false, error: 'not_archived' });
    await archiveAccount(store, account.id);
    expect(await deleteAccountPermanently(store, account.id)).toEqual({ ok: true });
    expect(rows.size).toBe(0);
    expect(tokens.size).toBe(0);
  });
});

describe('setAccountGroup', () => {
  it('sets, clears and rejects invalid groups', async () => {
    const { store, rows } = memoryStore();
    const { account } = await connectAccount(store, input);
    expect(await setAccountGroup(store, account.id, ' Brand  X ')).toEqual({ ok: true });
    expect(rows.get(account.id)!.groupName).toBe('Brand X');
    expect(await setAccountGroup(store, account.id, '')).toEqual({ ok: true });
    expect(rows.get(account.id)!.groupName).toBeNull();
    expect(await setAccountGroup(store, account.id, 'x'.repeat(41))).toEqual({ ok: false, error: 'invalid_group' });
    expect(await setAccountGroup(store, account.id, 'a\u0000')).toEqual({ ok: false, error: 'invalid_group' });
    expect(rows.get(account.id)!.groupName).toBeNull();
  });
});

describe('markNeedsReconnect', () => {
  it('flags an active account with a truncated reason', async () => {
    const { store, rows } = memoryStore();
    const { account } = await connectAccount(store, input);
    await markNeedsReconnect(store, '1784', 'r'.repeat(500));
    expect(rows.get(account.id)).toMatchObject({ status: 'needs_reconnect' });
    expect(rows.get(account.id)!.lastError).toHaveLength(200);
  });

  it('does nothing for unknown accounts and never resurrects an archived one', async () => {
    const { store, rows } = memoryStore();
    await markNeedsReconnect(store, 'nope', 'x'); // must not throw
    const { account } = await connectAccount(store, input);
    await archiveAccount(store, account.id);
    await markNeedsReconnect(store, '1784', 'revoked');
    expect(rows.get(account.id)!.status).toBe('archived');
  });
});
```

Run all three → FAIL (modules missing).

- [ ] **Step 2: Implement**

`lib/accounts/types.ts` — exactly the types in the Interfaces block above.

`lib/accounts/group.ts`:

```ts
const MAX = 40;

export function normalizeGroup(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false };
  // tabs/newlines are ordinary whitespace and collapse; other control characters are rejected
  const text = raw.replace(/[\t\n\r]+/g, ' ');
  if (/[\u0000-\u001f\u007f]/.test(text)) return { ok: false };
  const value = text.trim().replace(/\s+/g, ' ');
  if (value === '') return { ok: true, value: null };
  if ([...value].length > MAX) return { ok: false };
  return { ok: true, value };
}
```

`lib/accounts/token-status.ts`:

```ts
const DAY = 86_400_000;

export function tokenStatus(expiresAt: string | Date | null | undefined, now: Date): { state: 'ok' | 'expiring' | 'expired' | 'unknown'; daysLeft: number } {
  const t = expiresAt instanceof Date ? expiresAt.getTime() : typeof expiresAt === 'string' && expiresAt !== '' ? Date.parse(expiresAt) : NaN;
  if (Number.isNaN(t)) return { state: 'unknown', daysLeft: 0 };
  const ms = t - now.getTime();
  if (ms <= 0) return { state: 'expired', daysLeft: 0 };
  const daysLeft = Math.ceil(ms / DAY);
  return { state: daysLeft <= 7 ? 'expiring' : 'ok', daysLeft };
}
```

`lib/accounts/service.ts`:

```ts
import { normalizeGroup } from '@/lib/accounts/group';
import type { AccountsStore, StoredAccount } from '@/lib/accounts/types';

export interface ConnectInput {
  igUserId: string;
  username: string;
  displayName?: string | null;
  accountType?: string | null;
  profilePictureUrl?: string | null;
  groupName?: string | null; // undefined = keep the existing group
  accessToken: string;
  expiresAt: string;
}

export async function connectAccount(store: AccountsStore, input: ConnectInput): Promise<{ account: StoredAccount; outcome: 'created' | 'updated' | 'restored' }> {
  const profile = {
    username: input.username,
    displayName: input.displayName ?? null,
    accountType: input.accountType ?? null,
    profilePictureUrl: input.profilePictureUrl ?? null,
    tokenExpiresAt: input.expiresAt,
  };
  const existing = await store.findByIgUserId(input.igUserId);
  let account: StoredAccount;
  let outcome: 'created' | 'updated' | 'restored';
  if (!existing) {
    account = await store.insert({ igUserId: input.igUserId, ...profile, groupName: input.groupName ?? null });
    outcome = 'created';
  } else {
    outcome = existing.status === 'archived' ? 'restored' : 'updated';
    account = await store.update(existing.id, {
      ...profile,
      status: 'active',
      archivedAt: null,
      lastError: null,
      ...(input.groupName !== undefined ? { groupName: input.groupName } : {}),
    });
  }
  await store.saveToken(account.id, { accessToken: input.accessToken, expiresAt: input.expiresAt });
  return { account, outcome };
}

type Simple = { ok: true } | { ok: false; error: 'not_found' | 'not_archived' };

export async function archiveAccount(store: AccountsStore, id: string): Promise<Simple> {
  const a = await store.getById(id);
  if (!a) return { ok: false, error: 'not_found' };
  if (a.status !== 'archived') await store.update(id, { status: 'archived', archivedAt: new Date().toISOString() });
  return { ok: true };
}

export async function restoreAccount(store: AccountsStore, id: string): Promise<Simple> {
  const a = await store.getById(id);
  if (!a) return { ok: false, error: 'not_found' };
  if (a.status !== 'archived') return { ok: false, error: 'not_archived' };
  await store.update(id, { status: 'active', archivedAt: null });
  return { ok: true };
}

export async function deleteAccountPermanently(store: AccountsStore, id: string): Promise<Simple> {
  const a = await store.getById(id);
  if (!a) return { ok: false, error: 'not_found' };
  if (a.status !== 'archived') return { ok: false, error: 'not_archived' };
  await store.remove(id);
  return { ok: true };
}

export async function setAccountGroup(store: AccountsStore, id: string, raw: unknown): Promise<{ ok: true } | { ok: false; error: 'not_found' | 'invalid_group' }> {
  const g = normalizeGroup(raw);
  if (!g.ok) return { ok: false, error: 'invalid_group' };
  if (!(await store.getById(id))) return { ok: false, error: 'not_found' };
  await store.update(id, { groupName: g.value });
  return { ok: true };
}

export async function markNeedsReconnect(store: AccountsStore, igUserId: string, reason: string): Promise<void> {
  const a = await store.findByIgUserId(igUserId);
  if (!a || a.status === 'archived') return;
  await store.update(a.id, { status: 'needs_reconnect', lastError: reason.slice(0, 200) });
}
```

Run `npx vitest run tests/group.test.ts tests/token-status.test.ts tests/accounts-service.test.ts` → PASS. (The `archiveAccount` test needs `archivedAt` truthy: `new Date().toISOString()` satisfies it; the DB `check` in Task 1 requires archived ⇔ `archived_at` set, which the service honours.)

- [ ] **Step 3: Verify and commit**

Run: `npm run lint && npm run typecheck && npm test`.

```bash
git add lib/accounts tests/group.test.ts tests/token-status.test.ts tests/accounts-service.test.ts
git commit -m "feat: account rules (groups, token status, connect/archive/restore/delete service)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Supabase-backed `AccountsStore`

**Files:**
- Create: `lib/accounts/supabase-store.ts`, `tests/supabase-store.test.ts`

**Interfaces:**
- Consumes: `AccountsStore` & types (Task 2), `SupabaseClient`.
- Produces: `supabaseAccountsStore(db: SupabaseClient): AccountsStore` plus the pure mappers `rowToAccount(row)` / `patchToRow(patch)` / `newToRow(a)`. Uses tables `accounts` and `account_tokens` with the snake_case columns from the migration. Any Supabase `error` is thrown as `new Error('accounts store: <operation> failed')` — **the Supabase error text and any token are never included**.

- [ ] **Step 1: Write the failing test** — `tests/supabase-store.test.ts` with a tiny chainable recorder:

```ts
import { describe, expect, it } from 'vitest';
import { newToRow, patchToRow, rowToAccount, supabaseAccountsStore } from '@/lib/accounts/supabase-store';

type Call = { table: string; op: string; args: unknown[]; filters: [string, unknown][] };

function recorder(result: { data?: unknown; error?: unknown } = { data: null, error: null }) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, op: '', args: [], filters: [] };
      calls.push(call);
      const chain: Record<string, unknown> = {
        select: (...a: unknown[]) => ((call.op ||= 'select'), call.args.push(...a), chain),
        insert: (...a: unknown[]) => ((call.op = 'insert'), call.args.push(...a), chain),
        update: (...a: unknown[]) => ((call.op = 'update'), call.args.push(...a), chain),
        upsert: (...a: unknown[]) => ((call.op = 'upsert'), call.args.push(...a), chain),
        delete: () => ((call.op = 'delete'), chain),
        eq: (c: string, v: unknown) => (call.filters.push([c, v]), chain),
        order: () => chain,
        maybeSingle: async () => result,
        single: async () => result,
        then: (res: (v: unknown) => unknown) => Promise.resolve(result).then(res),
      };
      return chain;
    },
  };
  return { db: db as never, calls };
}

const row = { id: 'a1', ig_user_id: '1784', username: 'brandx', display_name: 'Brand X', account_type: 'Media_Creator', profile_picture_url: null, group_name: 'G', status: 'active', archived_at: null, last_error: null, token_expires_at: '2026-12-13T00:00:00Z', connected_at: '2026-10-14T00:00:00Z' };

describe('mappers', () => {
  it('rowToAccount maps snake_case to the domain shape', () => {
    expect(rowToAccount(row)).toEqual({ id: 'a1', igUserId: '1784', username: 'brandx', displayName: 'Brand X', accountType: 'Media_Creator', profilePictureUrl: null, groupName: 'G', status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: '2026-12-13T00:00:00Z', connectedAt: '2026-10-14T00:00:00Z' });
  });
  it('patchToRow only emits the fields present in the patch', () => {
    expect(patchToRow({ status: 'archived', archivedAt: 'x' })).toEqual({ status: 'archived', archived_at: 'x' });
    expect(patchToRow({})).toEqual({});
    expect(patchToRow({ groupName: null })).toEqual({ group_name: null });
  });
  it('newToRow maps a new account', () => {
    expect(newToRow({ igUserId: '1', username: 'u', displayName: null, accountType: null, profilePictureUrl: null, groupName: null, tokenExpiresAt: 't' })).toMatchObject({ ig_user_id: '1', username: 'u', group_name: null, token_expires_at: 't' });
  });
});

describe('supabaseAccountsStore', () => {
  it('findByIgUserId queries accounts by ig_user_id and maps the row', async () => {
    const { db, calls } = recorder({ data: row, error: null });
    expect((await supabaseAccountsStore(db).findByIgUserId('1784'))?.username).toBe('brandx');
    expect(calls[0]).toMatchObject({ table: 'accounts', filters: [['ig_user_id', '1784']] });
  });

  it('returns null when nothing is found', async () => {
    expect(await supabaseAccountsStore(recorder({ data: null, error: null }).db).getById('x')).toBeNull();
  });

  it('update filters by id', async () => {
    const { db, calls } = recorder({ data: row, error: null });
    await supabaseAccountsStore(db).update('a1', { status: 'active' });
    expect(calls[0]).toMatchObject({ table: 'accounts', op: 'update', filters: [['id', 'a1']] });
  });

  it('saveToken upserts into account_tokens keyed by account_id', async () => {
    const { db, calls } = recorder({ data: null, error: null });
    await supabaseAccountsStore(db).saveToken('a1', { accessToken: 'tok', expiresAt: '2026-12-13T00:00:00Z' });
    expect(calls[0]).toMatchObject({ table: 'account_tokens', op: 'upsert' });
    expect(calls[0].args[0]).toMatchObject({ account_id: 'a1', access_token: 'tok', expires_at: '2026-12-13T00:00:00Z' });
  });

  it('remove deletes the account row by id (tokens cascade in the database)', async () => {
    const { db, calls } = recorder({ data: null, error: null });
    await supabaseAccountsStore(db).remove('a1');
    expect(calls[0]).toMatchObject({ table: 'accounts', op: 'delete', filters: [['id', 'a1']] });
  });

  it('list returns mapped accounts', async () => {
    const { db } = recorder({ data: [row], error: null });
    expect((await supabaseAccountsStore(db).list()).map((a) => a.id)).toEqual(['a1']);
  });

  it('a Supabase error becomes a generic error that never leaks the original message or the token', async () => {
    const { db } = recorder({ data: null, error: { message: 'duplicate key value violates unique constraint "secret-ish" tok_abc' } });
    const store = supabaseAccountsStore(db);
    for (const run of [() => store.list(), () => store.saveToken('a1', { accessToken: 'tok_abc', expiresAt: 'x' }), () => store.remove('a1')]) {
      await expect(run()).rejects.toThrow(/accounts store: \w+ failed/);
      await expect(run()).rejects.not.toThrow(/tok_abc|secret-ish/);
    }
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement `lib/accounts/supabase-store.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountPatch, AccountsStore, NewAccount, StoredAccount } from '@/lib/accounts/types';

type Row = Record<string, unknown>;

export function rowToAccount(r: Row): StoredAccount {
  return {
    id: r.id as string,
    igUserId: r.ig_user_id as string,
    username: r.username as string,
    displayName: (r.display_name as string | null) ?? null,
    accountType: (r.account_type as string | null) ?? null,
    profilePictureUrl: (r.profile_picture_url as string | null) ?? null,
    groupName: (r.group_name as string | null) ?? null,
    status: r.status as StoredAccount['status'],
    archivedAt: (r.archived_at as string | null) ?? null,
    lastError: (r.last_error as string | null) ?? null,
    tokenExpiresAt: (r.token_expires_at as string | null) ?? null,
    connectedAt: r.connected_at as string,
  };
}

const PATCH_COLUMNS: Record<string, string> = {
  username: 'username',
  displayName: 'display_name',
  accountType: 'account_type',
  profilePictureUrl: 'profile_picture_url',
  groupName: 'group_name',
  status: 'status',
  archivedAt: 'archived_at',
  lastError: 'last_error',
  tokenExpiresAt: 'token_expires_at',
};

export function patchToRow(patch: AccountPatch): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(patch)) if (k in PATCH_COLUMNS) out[PATCH_COLUMNS[k]] = v;
  return out;
}

export function newToRow(a: NewAccount): Row {
  return {
    ig_user_id: a.igUserId,
    username: a.username,
    display_name: a.displayName,
    account_type: a.accountType,
    profile_picture_url: a.profilePictureUrl,
    group_name: a.groupName,
    token_expires_at: a.tokenExpiresAt,
  };
}

function fail(op: string): never {
  // never include the Supabase message: it can echo values (including tokens)
  throw new Error(`accounts store: ${op} failed`);
}

export function supabaseAccountsStore(db: SupabaseClient): AccountsStore {
  return {
    async list() {
      const { data, error } = await db.from('accounts').select('*').order('connected_at', { ascending: true });
      if (error) fail('list');
      return ((data ?? []) as Row[]).map(rowToAccount);
    },
    async getById(id) {
      const { data, error } = await db.from('accounts').select('*').eq('id', id).maybeSingle();
      if (error) fail('getById');
      return data ? rowToAccount(data as Row) : null;
    },
    async findByIgUserId(igUserId) {
      const { data, error } = await db.from('accounts').select('*').eq('ig_user_id', igUserId).maybeSingle();
      if (error) fail('findByIgUserId');
      return data ? rowToAccount(data as Row) : null;
    },
    async insert(a) {
      const { data, error } = await db.from('accounts').insert(newToRow(a)).select('*').single();
      if (error || !data) fail('insert');
      return rowToAccount(data as Row);
    },
    async update(id, patch) {
      const { data, error } = await db.from('accounts').update(patchToRow(patch)).eq('id', id).select('*').single();
      if (error || !data) fail('update');
      return rowToAccount(data as Row);
    },
    async saveToken(accountId, token) {
      const { error } = await db.from('account_tokens').upsert({ account_id: accountId, access_token: token.accessToken, expires_at: token.expiresAt, refreshed_at: new Date().toISOString() });
      if (error) fail('saveToken');
    },
    async remove(id) {
      const { error } = await db.from('accounts').delete().eq('id', id);
      if (error) fail('remove');
    },
  };
}
```

Run `npx vitest run tests/supabase-store.test.ts` → PASS.

- [ ] **Step 3: Verify and commit**

Run: `npm run lint && npm run typecheck && npm test`.

```bash
git add lib/accounts/supabase-store.ts tests/supabase-store.test.ts
git commit -m "feat: Supabase-backed accounts store with generic, leak-free errors" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Instagram OAuth client

**Files:**
- Create: `lib/instagram/oauth.ts`, `tests/instagram-oauth.test.ts`
- Modify: `lib/env.ts` (+ `getInstagramEnv`), `tests/env.test.ts`, `tests/admin-guard.test.ts` (secret isolation)

**Interfaces:**
- Produces:

```ts
export const IG_SCOPES = ['instagram_business_basic', 'instagram_business_manage_insights'] as const;
export interface IgConfig { appId: string; appSecret: string; redirectUri: string; apiVersion: string }
export class InstagramApiError extends Error { constructor(public kind: 'oauth' | 'token' | 'profile' | 'network', public status?: number, public code?: number) }
export function buildAuthorizeUrl(cfg: IgConfig, state: string): string;
export function exchangeCode(cfg: IgConfig, code: string, fetchFn?: typeof fetch): Promise<{ accessToken: string; userId: string }>;
export function exchangeLongLived(cfg: IgConfig, shortToken: string, fetchFn?: typeof fetch): Promise<{ accessToken: string; expiresAt: string }>;
export function refreshLongLived(accessToken: string, fetchFn?: typeof fetch, now?: Date): Promise<{ accessToken: string; expiresAt: string }>;
export interface IgProfile { userId: string; username: string; name: string | null; accountType: string | null; profilePictureUrl: string | null }
export function fetchProfile(cfg: IgConfig, accessToken: string, fetchFn?: typeof fetch): Promise<IgProfile>;
export function isProfessional(accountType: string | null): boolean; // Business | Media_Creator (case-insensitive)
```
  `getInstagramEnv(): IgConfig` in `lib/env.ts` reads `IG_APP_ID`, `IG_APP_SECRET`, `IG_REDIRECT_URI`, `IG_API_VERSION` (default `v25.0` when empty); throws `EnvError` listing missing **names**.
  `InstagramApiError.message` is a fixed string per `kind` (e.g. `instagram oauth failed`) — never the response body, token, code or secret.

- [ ] **Step 1: Write the failing tests** — `tests/instagram-oauth.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest';
import { IG_SCOPES, InstagramApiError, buildAuthorizeUrl, exchangeCode, exchangeLongLived, fetchProfile, isProfessional, refreshLongLived, type IgConfig } from '@/lib/instagram/oauth';

const cfg: IgConfig = { appId: '1234567890', appSecret: 'sekrit-app-secret', redirectUri: 'https://app.test/api/instagram/callback', apiVersion: 'v25.0' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fetchReturning = (res: Response | (() => Response)) => vi.fn(async () => (typeof res === 'function' ? res() : res)) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe('buildAuthorizeUrl', () => {
  it('points at the Instagram authorization window with exactly the required parameters', () => {
    const u = new URL(buildAuthorizeUrl(cfg, 'state123'));
    expect(u.origin + u.pathname).toBe('https://www.instagram.com/oauth/authorize');
    expect(u.searchParams.get('client_id')).toBe('1234567890');
    expect(u.searchParams.get('redirect_uri')).toBe(cfg.redirectUri);
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('state')).toBe('state123');
    expect(u.searchParams.get('force_reauth')).toBe('true');
    expect(u.searchParams.get('scope')).toBe('instagram_business_basic,instagram_business_manage_insights');
  });
  it('asks for read-only scopes only', () => {
    expect([...IG_SCOPES]).toEqual(['instagram_business_basic', 'instagram_business_manage_insights']);
    expect(buildAuthorizeUrl(cfg, 's')).not.toMatch(/manage_messages|manage_comments|content_publish/);
  });
  it('never contains the app secret', () => {
    expect(buildAuthorizeUrl(cfg, 's')).not.toContain('sekrit');
  });
});

describe('exchangeCode', () => {
  it('POSTs form-encoded credentials to the token endpoint', async () => {
    const f = fetchReturning(json({ access_token: 'short1', user_id: 1784, permissions: 'instagram_business_basic' }));
    expect(await exchangeCode(cfg, 'CODE', f)).toEqual({ accessToken: 'short1', userId: '1784' });
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe('https://api.instagram.com/oauth/access_token');
    expect(init.method).toBe('POST');
    const body = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(body)).toMatchObject({ client_id: '1234567890', client_secret: 'sekrit-app-secret', grant_type: 'authorization_code', redirect_uri: cfg.redirectUri, code: 'CODE' });
  });
  it('understands the { data: [ ... ] } response shape too', async () => {
    const f = fetchReturning(json({ data: [{ access_token: 'short2', user_id: '99', permissions: 'x' }] }));
    expect(await exchangeCode(cfg, 'C', f)).toEqual({ accessToken: 'short2', userId: '99' });
  });
  it('rejects a response without a token or user id', async () => {
    await expect(exchangeCode(cfg, 'C', fetchReturning(json({ access_token: 'only' })))).rejects.toBeInstanceOf(InstagramApiError);
    await expect(exchangeCode(cfg, 'C', fetchReturning(json({})))).rejects.toBeInstanceOf(InstagramApiError);
  });
});

describe('exchangeLongLived / refreshLongLived', () => {
  it('exchange sends grant_type=ig_exchange_token and converts expires_in to an ISO date', async () => {
    const f = fetchReturning(json({ access_token: 'long1', token_type: 'bearer', expires_in: 5184000 }));
    const r = await exchangeLongLived(cfg, 'short1', f);
    expect(r.accessToken).toBe('long1');
    const u = new URL((f as unknown as { mock: { calls: [string][] } }).mock.calls[0][0]);
    expect(u.origin + u.pathname).toBe('https://graph.instagram.com/access_token');
    expect(u.searchParams.get('grant_type')).toBe('ig_exchange_token');
    expect(u.searchParams.get('client_secret')).toBe('sekrit-app-secret');
    expect(u.searchParams.get('access_token')).toBe('short1');
    expect(Date.parse(r.expiresAt) - Date.now()).toBeGreaterThan(59 * 86_400_000);
    expect(Date.parse(r.expiresAt) - Date.now()).toBeLessThan(61 * 86_400_000);
  });
  it('refresh uses ig_refresh_token and the now parameter', async () => {
    const f = fetchReturning(json({ access_token: 'long2', expires_in: 5184000 }));
    const now = new Date('2026-10-14T00:00:00Z');
    const r = await refreshLongLived('long1', f, now);
    expect(r).toEqual({ accessToken: 'long2', expiresAt: '2026-12-13T00:00:00.000Z' });
    const u = new URL((f as unknown as { mock: { calls: [string][] } }).mock.calls[0][0]);
    expect(u.pathname).toBe('/refresh_access_token');
    expect(u.searchParams.get('grant_type')).toBe('ig_refresh_token');
    expect(u.searchParams.has('client_secret')).toBe(false);
  });
  it('a missing expires_in is an error, not a token that never expires', async () => {
    await expect(exchangeLongLived(cfg, 's', fetchReturning(json({ access_token: 'x' })))).rejects.toBeInstanceOf(InstagramApiError);
  });
});

describe('fetchProfile / isProfessional', () => {
  it('requests the profile fields from the versioned /me endpoint', async () => {
    const f = fetchReturning(json({ user_id: '1784', username: 'brandx', name: 'Brand X', account_type: 'Media_Creator', profile_picture_url: 'https://cdn/x.jpg' }));
    expect(await fetchProfile(cfg, 'long1', f)).toEqual({ userId: '1784', username: 'brandx', name: 'Brand X', accountType: 'Media_Creator', profilePictureUrl: 'https://cdn/x.jpg' });
    const u = new URL((f as unknown as { mock: { calls: [string][] } }).mock.calls[0][0]);
    expect(u.origin + u.pathname).toBe('https://graph.instagram.com/v25.0/me');
    expect(u.searchParams.get('fields')).toBe('user_id,username,name,account_type,profile_picture_url');
    expect(u.searchParams.get('access_token')).toBe('long1');
  });
  it('requires a user id and a username', async () => {
    await expect(fetchProfile(cfg, 't', fetchReturning(json({ username: 'x' })))).rejects.toBeInstanceOf(InstagramApiError);
    await expect(fetchProfile(cfg, 't', fetchReturning(json({ user_id: '1' })))).rejects.toBeInstanceOf(InstagramApiError);
  });
  it('isProfessional accepts Business and Media_Creator in any case and nothing else', () => {
    for (const t of ['Business', 'BUSINESS', 'Media_Creator', 'media_creator']) expect(isProfessional(t), t).toBe(true);
    for (const t of ['Personal', 'PERSONAL', '', null, 'Creator', 'Business ']) expect(isProfessional(t as never), String(t)).toBe(false);
  });
});

describe('errors never leak secrets', () => {
  const secrets = ['sekrit-app-secret', 'short1', 'long1', 'THE-CODE'];
  const leak = (e: unknown) => JSON.stringify({ m: (e as Error).message, k: (e as InstagramApiError).kind, s: (e as InstagramApiError).status, c: (e as InstagramApiError).code });
  it('HTTP errors (even when the body echoes secrets) become a fixed message with kind/status/code only', async () => {
    const body = { error: { message: 'Invalid code THE-CODE for sekrit-app-secret token short1', type: 'OAuthException', code: 190 }, error_message: 'bad long1' };
    for (const run of [
      () => exchangeCode(cfg, 'THE-CODE', fetchReturning(json(body, 400))),
      () => exchangeLongLived(cfg, 'short1', fetchReturning(json(body, 400))),
      () => refreshLongLived('long1', fetchReturning(json(body, 400))),
      () => fetchProfile(cfg, 'long1', fetchReturning(json(body, 400))),
    ]) {
      const e = await run().catch((x) => x);
      expect(e).toBeInstanceOf(InstagramApiError);
      for (const s of secrets) expect(leak(e)).not.toContain(s);
      expect((e as InstagramApiError).status).toBe(400);
    }
  });
  it('parses the numeric error code from both Meta error shapes', async () => {
    const a = await exchangeCode(cfg, 'c', fetchReturning(json({ error_type: 'OAuthException', code: 400, error_message: 'x' }, 400))).catch((x) => x);
    const b = await fetchProfile(cfg, 't', fetchReturning(json({ error: { message: 'x', code: 190 } }, 400))).catch((x) => x);
    expect((a as InstagramApiError).code).toBe(400);
    expect((b as InstagramApiError).code).toBe(190);
  });
  it('network failures and non-JSON bodies become InstagramApiError("network"/kind) without details', async () => {
    const boom = vi.fn(async () => { throw new Error('connect ECONNRESET token short1'); }) as unknown as typeof fetch;
    const e = await exchangeCode(cfg, 'c', boom).catch((x) => x);
    expect(e).toBeInstanceOf(InstagramApiError);
    expect((e as InstagramApiError).kind).toBe('network');
    expect(leak(e)).not.toContain('short1');
    const notJson = await exchangeCode(cfg, 'c', fetchReturning(new Response('<html>oops</html>', { status: 502 }))).catch((x) => x);
    expect(notJson).toBeInstanceOf(InstagramApiError);
    expect((notJson as InstagramApiError).status).toBe(502);
  });
});
```

Add to `tests/env.test.ts`:

```ts
import { getInstagramEnv } from '@/lib/env';
describe('getInstagramEnv', () => {
  it('reads the four variables and defaults the API version', () => {
    vi.stubEnv('IG_APP_ID', '123'); vi.stubEnv('IG_APP_SECRET', 'abc'); vi.stubEnv('IG_REDIRECT_URI', 'https://x/cb'); vi.stubEnv('IG_API_VERSION', '');
    expect(getInstagramEnv()).toEqual({ appId: '123', appSecret: 'abc', redirectUri: 'https://x/cb', apiVersion: 'v25.0' });
  });
  it('lists missing NAMES only', () => {
    vi.stubEnv('IG_APP_ID', '123'); vi.stubEnv('IG_APP_SECRET', ''); vi.stubEnv('IG_REDIRECT_URI', '');
    try { getInstagramEnv(); throw new Error('no'); } catch (e) {
      expect((e as EnvError).missing).toEqual(['IG_APP_SECRET', 'IG_REDIRECT_URI']);
      expect((e as Error).message).not.toContain('123');
    }
  });
});
```

Update `tests/admin-guard.test.ts` second test so it asserts `IG_APP_SECRET` is referenced only in `lib/env.ts` (same pattern as `SUPABASE_SECRET_KEY`) and that no `"use client"` file mentions `IG_APP_SECRET` or `getInstagramEnv`.

Run → FAIL.

- [ ] **Step 2: Implement `lib/instagram/oauth.ts`**

```ts
export const IG_SCOPES = ['instagram_business_basic', 'instagram_business_manage_insights'] as const;

export interface IgConfig { appId: string; appSecret: string; redirectUri: string; apiVersion: string }
export interface IgProfile { userId: string; username: string; name: string | null; accountType: string | null; profilePictureUrl: string | null }

type Kind = 'oauth' | 'token' | 'profile' | 'network';
const MESSAGES: Record<Kind, string> = {
  oauth: 'instagram oauth failed',
  token: 'instagram token request failed',
  profile: 'instagram profile request failed',
  network: 'instagram request failed (network)',
};

/** Fixed message per kind: response bodies, tokens, codes and secrets never end up in an error. */
export class InstagramApiError extends Error {
  constructor(public kind: Kind, public status?: number, public code?: number) {
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

async function call(kind: Kind, fetchFn: typeof fetch, url: string, init?: RequestInit): Promise<Record<string, unknown>> {
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
    const err = body.error as { code?: unknown } | undefined;
    const raw = typeof err === 'object' && err ? err.code : body.code;
    throw new InstagramApiError(kind, res.status, typeof raw === 'number' ? raw : undefined);
  }
  return body;
}

export async function exchangeCode(cfg: IgConfig, code: string, fetchFn: typeof fetch = fetch): Promise<{ accessToken: string; userId: string }> {
  const body = await call('oauth', fetchFn, 'https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.appId, client_secret: cfg.appSecret, grant_type: 'authorization_code', redirect_uri: cfg.redirectUri, code }).toString(),
  });
  const first = (Array.isArray(body.data) ? (body.data as Record<string, unknown>[])[0] : body) ?? {};
  const token = first.access_token;
  const user = first.user_id;
  if (typeof token !== 'string' || token === '' || (typeof user !== 'string' && typeof user !== 'number')) throw new InstagramApiError('oauth');
  return { accessToken: token, userId: String(user) };
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

export async function refreshLongLived(accessToken: string, fetchFn: typeof fetch = fetch, now: Date = new Date()) {
  const u = new URL('https://graph.instagram.com/refresh_access_token');
  u.searchParams.set('grant_type', 'ig_refresh_token');
  u.searchParams.set('access_token', accessToken);
  return longLived(await call('token', fetchFn, u.toString()), now);
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
```

(`exchangeLongLived`'s third/fourth params let tests pass `now`; the first test uses the default clock.) Add `getInstagramEnv` to `lib/env.ts` next to `getServerEnv`:

```ts
export function getInstagramEnv() {
  const v = need({ IG_APP_ID: process.env.IG_APP_ID, IG_APP_SECRET: process.env.IG_APP_SECRET, IG_REDIRECT_URI: process.env.IG_REDIRECT_URI });
  const version = process.env.IG_API_VERSION?.trim();
  return { appId: v.IG_APP_ID, appSecret: v.IG_APP_SECRET, redirectUri: v.IG_REDIRECT_URI, apiVersion: version ? version : 'v25.0' };
}
```

Run the three test files → PASS.

- [ ] **Step 3: Verify and commit**

Run: `npm run lint && npm run typecheck && npm test`.

```bash
git add lib/instagram/oauth.ts lib/env.ts tests/instagram-oauth.test.ts tests/env.test.ts tests/admin-guard.test.ts
git commit -m "feat: Instagram OAuth client (authorize URL, token exchange, refresh, profile) with leak-free errors" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: OAuth state cookie and Meta `signed_request`

**Files:**
- Create: `lib/instagram/state.ts`, `lib/instagram/signed-request.ts`, `tests/instagram-state.test.ts`, `tests/signed-request.test.ts`

**Interfaces:**
- Produces:
  - `newOAuthState(group: string | null, now?: number): { state: string; cookie: string }` — `state` = 24 random bytes base64url; `cookie` = base64url JSON `{ s: state, g: group, t: now }`.
  - `verifyOAuthState(cookie: string | undefined, queryState: string | null, now?: number): { ok: true; group: string | null } | { ok: false }` — constant-time compare; rejects missing/malformed/expired (`now - t > 10 * 60_000` or `t` in the future by > 60 s) cookies and any mismatch.
  - `STATE_COOKIE = 'ig_oauth'`, `STATE_MAX_AGE_SECONDS = 600`.
  - `parseSignedRequest(signedRequest: string, appSecret: string): { userId: string } | null` — format `<signature>.<payload>` (both base64url); verifies `HMAC-SHA256(payload, appSecret)` with `timingSafeEqual`; payload JSON must have `algorithm` equal to `HMAC-SHA256` (case-insensitive) and a `user_id` (string or number, non-empty); anything else → `null`, never throws.

- [ ] **Step 1: Write the failing tests**

`tests/instagram-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { newOAuthState, verifyOAuthState } from '@/lib/instagram/state';

describe('OAuth state', () => {
  it('generates unguessable, url-safe, unique states', () => {
    const a = newOAuthState(null);
    const b = newOAuthState(null);
    expect(a.state).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(a.state).not.toBe(b.state);
    expect(a.cookie).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('accepts the matching state and returns the group chosen at the start', () => {
    const { state, cookie } = newOAuthState('Brand X');
    expect(verifyOAuthState(cookie, state)).toEqual({ ok: true, group: 'Brand X' });
    const n = newOAuthState(null);
    expect(verifyOAuthState(n.cookie, n.state)).toEqual({ ok: true, group: null });
  });

  it('rejects missing, wrong or swapped states', () => {
    const a = newOAuthState(null);
    const b = newOAuthState(null);
    expect(verifyOAuthState(undefined, a.state)).toEqual({ ok: false });
    expect(verifyOAuthState(a.cookie, null)).toEqual({ ok: false });
    expect(verifyOAuthState(a.cookie, '')).toEqual({ ok: false });
    expect(verifyOAuthState(a.cookie, b.state)).toEqual({ ok: false });
    expect(verifyOAuthState(a.cookie, a.state + 'x')).toEqual({ ok: false });
  });

  it('rejects malformed or tampered cookies without throwing', () => {
    const { state } = newOAuthState(null);
    for (const bad of ['', 'not-base64!!', Buffer.from('{"s":1}').toString('base64url'), Buffer.from('null').toString('base64url'), Buffer.from('[]').toString('base64url')])
      expect(verifyOAuthState(bad, state), bad).toEqual({ ok: false });
  });

  it('expires after 10 minutes and rejects a cookie from the future', () => {
    const t0 = 1_700_000_000_000;
    const { state, cookie } = newOAuthState(null, t0);
    expect(verifyOAuthState(cookie, state, t0 + 9 * 60_000)).toMatchObject({ ok: true });
    expect(verifyOAuthState(cookie, state, t0 + 10 * 60_000 + 1)).toEqual({ ok: false });
    expect(verifyOAuthState(cookie, state, t0 - 5 * 60_000)).toEqual({ ok: false });
  });
});
```

`tests/signed-request.test.ts`:

```ts
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
```

Run → FAIL.

- [ ] **Step 2: Implement**

`lib/instagram/state.ts`:

```ts
import { randomBytes, timingSafeEqual } from 'node:crypto';

export const STATE_COOKIE = 'ig_oauth';
export const STATE_MAX_AGE_SECONDS = 600;
const MAX_AGE_MS = STATE_MAX_AGE_SECONDS * 1000;
const FUTURE_SKEW_MS = 60_000;

export function newOAuthState(group: string | null, now: number = Date.now()): { state: string; cookie: string } {
  const state = randomBytes(24).toString('base64url');
  const cookie = Buffer.from(JSON.stringify({ s: state, g: group, t: now })).toString('base64url');
  return { state, cookie };
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function verifyOAuthState(cookie: string | undefined, queryState: string | null, now: number = Date.now()): { ok: true; group: string | null } | { ok: false } {
  if (!cookie || !queryState) return { ok: false };
  try {
    const v = JSON.parse(Buffer.from(cookie, 'base64url').toString('utf8')) as { s?: unknown; g?: unknown; t?: unknown };
    if (!v || typeof v !== 'object' || typeof v.s !== 'string' || typeof v.t !== 'number') return { ok: false };
    if (now - v.t > MAX_AGE_MS || v.t - now > FUTURE_SKEW_MS) return { ok: false };
    if (!safeEqual(v.s, queryState)) return { ok: false };
    return { ok: true, group: typeof v.g === 'string' ? v.g : null };
  } catch {
    return { ok: false };
  }
}
```

`lib/instagram/signed-request.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export function parseSignedRequest(signedRequest: string, appSecret: string): { userId: string } | null {
  try {
    if (!appSecret || typeof signedRequest !== 'string') return null;
    const parts = signedRequest.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const [sig, payload] = parts;
    const expected = createHmac('sha256', appSecret).update(payload).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { algorithm?: unknown; user_id?: unknown };
    if (typeof data.algorithm !== 'string' || data.algorithm.toUpperCase() !== 'HMAC-SHA256') return null;
    const id = data.user_id;
    if ((typeof id !== 'string' && typeof id !== 'number') || String(id) === '') return null;
    return { userId: String(id) };
  } catch {
    return null;
  }
}
```

Run both test files → PASS.

- [ ] **Step 3: Verify and commit**

Run: `npm run lint && npm run typecheck && npm test`.

```bash
git add lib/instagram/state.ts lib/instagram/signed-request.ts tests/instagram-state.test.ts tests/signed-request.test.ts
git commit -m "feat: constant-time OAuth state cookie and Meta signed_request verification" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Connect flow orchestration and route handlers

**Files:**
- Create: `lib/auth/assert-owner.ts`, `lib/instagram/connect-flow.ts`, `app/api/instagram/connect/route.ts`, `app/api/instagram/callback/route.ts`, `app/api/instagram/deauthorize/route.ts`, `app/api/instagram/delete/route.ts`, `tests/connect-flow.test.ts`, `tests/instagram-routes.test.ts`

**Interfaces:**
- Consumes: Tasks 2-5 modules; `getSessionInfo`, `createServerSupabase`, `createAdminSupabase`, `getInstagramEnv`.
- Produces:
  - `assertOwner(): Promise<boolean>` — `getSessionInfo(await createServerSupabase())`: signed in and (`!mfaRequired || aal === 'aal2'`).
  - `processCallback(input, deps): Promise<{ redirect: string }>` in `lib/instagram/connect-flow.ts`:

```ts
export interface CallbackInput { code: string | null; state: string | null; error: string | null; cookie: string | undefined }
export interface CallbackDeps { cfg: IgConfig; store: AccountsStore; fetchFn?: typeof fetch; now?: Date }
// redirect is always one of: /accounts?connected=<username> | /accounts?error=<key>
// key ∈ access_denied | state_mismatch | missing_code | exchange_failed | profile_failed | not_professional | save_failed
```
    Order: (1) `error` present → `access_denied` (**before** state is checked? No — verify state first so an attacker can't make us act on a forged callback; but `access_denied` redirects carry no data and touch nothing, so check `error` after state verification); (2) state invalid → `state_mismatch` with **no network and no store calls**; (3) no code → `missing_code`; (4) `exchangeCode` then `exchangeLongLived` (any `InstagramApiError` → `exchange_failed`); (5) `fetchProfile` (error → `profile_failed`); (6) `!isProfessional(accountType)` → `not_professional`, nothing saved; (7) `connectAccount(store, …)` (throw → `save_failed`); success → `connected=<encodeURIComponent(username)>`. `groupName` passed to `connectAccount`: the group from the state cookie if set (normalised via `normalizeGroup`, invalid → treated as not provided), else `undefined`.
  - Route handlers: `GET /api/instagram/connect?group=…` (owner check → 401 JSON if not; `normalizeGroup` the param (invalid → ignore); `newOAuthState`; sets the `STATE_COOKIE` (httpOnly, `sameSite: 'lax'`, `secure` in production, `path: '/api/instagram'`, `maxAge: STATE_MAX_AGE_SECONDS`); redirects (307) to `buildAuthorizeUrl`; if Instagram env is missing → redirect `/accounts?error=not_configured`), `GET /api/instagram/callback` (owner check; reads query + cookie; `processCallback` with the admin-client store; clears the state cookie on every outcome; 307 redirect), `POST /api/instagram/deauthorize` and `POST /api/instagram/delete` (read form field `signed_request`; invalid/missing → 400 `{error:'invalid_request'}` with **no** store call; valid → `deauthorize`: `markNeedsReconnect(store, userId, 'deauthorized')`, respond `200 {}`; `delete`: same effect (the account is kept archived-or-flagged; history is the owner's data), respond `200 {"url": "<APP_URL>/accounts", "confirmation_code": "<random hex>"}`).

- [ ] **Step 1: Write the failing orchestration test** — `tests/connect-flow.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest';
import type { AccountsStore, StoredAccount } from '@/lib/accounts/types';
import { processCallback } from '@/lib/instagram/connect-flow';
import type { IgConfig } from '@/lib/instagram/oauth';
import { newOAuthState } from '@/lib/instagram/state';

const cfg: IgConfig = { appId: '123', appSecret: 'sekrit', redirectUri: 'https://app.test/api/instagram/callback', apiVersion: 'v25.0' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

function storeSpy() {
  const calls: string[] = [];
  const rows: StoredAccount[] = [];
  const store: AccountsStore = {
    list: async () => rows,
    getById: async (id) => rows.find((r) => r.id === id) ?? null,
    findByIgUserId: async (ig) => (calls.push('find'), rows.find((r) => r.igUserId === ig) ?? null),
    insert: async (a) => {
      calls.push('insert');
      const r: StoredAccount = { id: 'a1', ...a, status: 'active', archivedAt: null, lastError: null, connectedAt: 'now' };
      rows.push(r);
      return r;
    },
    update: async (id, p) => (calls.push('update'), Object.assign(rows.find((r) => r.id === id)!, p)),
    saveToken: async () => void calls.push('saveToken'),
    remove: async () => undefined,
  };
  return { store, calls, rows };
}

function happyFetch(profile: Record<string, unknown> = { user_id: '1784', username: 'brandx', account_type: 'Media_Creator' }) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes('api.instagram.com/oauth/access_token')) return json({ access_token: 'short', user_id: 1784 });
    if (u.includes('/access_token')) return json({ access_token: 'long', expires_in: 5184000 });
    if (u.includes('/me')) return json(profile);
    return json({}, 404);
  }) as unknown as typeof fetch & { mock: { calls: unknown[][] } };
}

const start = (group: string | null = null) => newOAuthState(group);
const run = (over: Partial<Parameters<typeof processCallback>[0]>, deps: Partial<Parameters<typeof processCallback>[1]> & { store: AccountsStore }) =>
  processCallback({ code: 'CODE', state: null, error: null, cookie: undefined, ...over }, { cfg, ...deps });

describe('processCallback — success', () => {
  it('exchanges, fetches the profile, saves the account and redirects with the username', async () => {
    const { store, rows } = storeSpy();
    const s = start('Brand X');
    const r = await run({ state: s.state, cookie: s.cookie }, { store, fetchFn: happyFetch() });
    expect(r).toEqual({ redirect: '/accounts?connected=brandx' });
    expect(rows[0]).toMatchObject({ igUserId: '1784', username: 'brandx', groupName: 'Brand X', status: 'active' });
  });

  it('no group chosen -> existing group is untouched (undefined), new account is isolated', async () => {
    const { store, rows } = storeSpy();
    const s = start(null);
    await run({ state: s.state, cookie: s.cookie }, { store, fetchFn: happyFetch() });
    expect(rows[0].groupName).toBeNull();
  });

  it('url-encodes unusual usernames in the redirect', async () => {
    const { store } = storeSpy();
    const s = start();
    const r = await run({ state: s.state, cookie: s.cookie }, { store, fetchFn: happyFetch({ user_id: '1', username: 'a b&c', account_type: 'Business' }) });
    expect(r.redirect).toBe('/accounts?connected=a%20b%26c');
  });
});

describe('processCallback — refusals (nothing saved, no network before state is verified)', () => {
  it.each([
    ['no cookie', (s: ReturnType<typeof start>) => ({ state: s.state, cookie: undefined })],
    ['no state in the query', (s: ReturnType<typeof start>) => ({ state: null, cookie: s.cookie })],
    ['state mismatch', (s: ReturnType<typeof start>) => ({ state: s.state + 'x', cookie: s.cookie })],
    ['someone else\'s cookie', () => ({ state: start().state, cookie: start().cookie })],
  ])('%s -> state_mismatch without any Instagram or database call', async (_n, make) => {
    const { store, calls } = storeSpy();
    const f = happyFetch();
    const r = await run(make(start()), { store, fetchFn: f });
    expect(r).toEqual({ redirect: '/accounts?error=state_mismatch' });
    expect(f).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('an expired state is a mismatch', async () => {
    const { store, calls } = storeSpy();
    const old = newOAuthState(null, Date.now() - 20 * 60_000);
    expect(await run({ state: old.state, cookie: old.cookie }, { store, fetchFn: happyFetch() })).toEqual({ redirect: '/accounts?error=state_mismatch' });
    expect(calls).toEqual([]);
  });

  it('the user denying consent -> access_denied, nothing saved, no code exchange', async () => {
    const { store, calls } = storeSpy();
    const s = start();
    const f = happyFetch();
    expect(await run({ state: s.state, cookie: s.cookie, error: 'access_denied', code: null }, { store, fetchFn: f })).toEqual({ redirect: '/accounts?error=access_denied' });
    expect(f).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('a missing code -> missing_code', async () => {
    const { store } = storeSpy();
    const s = start();
    expect(await run({ state: s.state, cookie: s.cookie, code: null }, { store, fetchFn: happyFetch() })).toEqual({ redirect: '/accounts?error=missing_code' });
  });

  it('a personal (non-professional) account is rejected and not saved', async () => {
    const { store, calls } = storeSpy();
    const s = start();
    const r = await run({ state: s.state, cookie: s.cookie }, { store, fetchFn: happyFetch({ user_id: '5', username: 'me', account_type: 'Personal' }) });
    expect(r).toEqual({ redirect: '/accounts?error=not_professional' });
    expect(calls).toEqual([]);
  });

  it('a profile without an account_type is rejected too', async () => {
    const { store } = storeSpy();
    const s = start();
    const r = await run({ state: s.state, cookie: s.cookie }, { store, fetchFn: happyFetch({ user_id: '5', username: 'me' }) });
    expect(r).toEqual({ redirect: '/accounts?error=not_professional' });
  });

  it('Instagram errors map to exchange_failed / profile_failed without leaking anything', async () => {
    const { store, calls } = storeSpy();
    const s1 = start();
    const bad = vi.fn(async () => json({ error: { message: 'bad CODE sekrit', code: 190 } }, 400)) as unknown as typeof fetch;
    const r1 = await run({ state: s1.state, cookie: s1.cookie }, { store, fetchFn: bad });
    expect(r1).toEqual({ redirect: '/accounts?error=exchange_failed' });

    const s2 = start();
    const f = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('api.instagram.com')) return json({ access_token: 's', user_id: 1 });
      if (u.includes('/access_token')) return json({ access_token: 'l', expires_in: 100 });
      return json({ error: { message: 'x', code: 100 } }, 400);
    }) as unknown as typeof fetch;
    expect(await run({ state: s2.state, cookie: s2.cookie }, { store, fetchFn: f })).toEqual({ redirect: '/accounts?error=profile_failed' });
    expect(calls).toEqual([]);
  });

  it('a storage failure -> save_failed (and the redirect carries no detail)', async () => {
    const { store } = storeSpy();
    store.findByIgUserId = async () => { throw new Error('db down sekrit'); };
    const s = start();
    const r = await run({ state: s.state, cookie: s.cookie }, { store, fetchFn: happyFetch() });
    expect(r).toEqual({ redirect: '/accounts?error=save_failed' });
    expect(JSON.stringify(r)).not.toContain('sekrit');
  });

  it('every redirect is a same-site relative path under /accounts', async () => {
    const { store } = storeSpy();
    const s = start();
    const r = await run({ state: s.state, cookie: s.cookie }, { store, fetchFn: happyFetch() });
    expect(r.redirect.startsWith('/accounts?')).toBe(true);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement `lib/instagram/connect-flow.ts`**

```ts
import { normalizeGroup } from '@/lib/accounts/group';
import { connectAccount } from '@/lib/accounts/service';
import type { AccountsStore } from '@/lib/accounts/types';
import { InstagramApiError, exchangeCode, exchangeLongLived, fetchProfile, isProfessional, type IgConfig } from '@/lib/instagram/oauth';
import { verifyOAuthState } from '@/lib/instagram/state';

export interface CallbackInput { code: string | null; state: string | null; error: string | null; cookie: string | undefined }
export interface CallbackDeps { cfg: IgConfig; store: AccountsStore; fetchFn?: typeof fetch; now?: Date }

const to = (key: string) => ({ redirect: `/accounts?error=${key}` });

export async function processCallback(input: CallbackInput, deps: CallbackDeps): Promise<{ redirect: string }> {
  // 1. CSRF check first: a forged callback must cause no network call and no database access
  const st = verifyOAuthState(input.cookie, input.state);
  if (!st.ok) return to('state_mismatch');
  if (input.error) return to('access_denied');
  if (!input.code) return to('missing_code');

  const fetchFn = deps.fetchFn ?? fetch;
  let token: { accessToken: string; expiresAt: string };
  try {
    const short = await exchangeCode(deps.cfg, input.code, fetchFn);
    token = await exchangeLongLived(deps.cfg, short.accessToken, fetchFn, deps.now);
  } catch (e) {
    if (e instanceof InstagramApiError) return to('exchange_failed');
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
    await connectAccount(deps.store, {
      igUserId: profile.userId,
      username: profile.username,
      displayName: profile.name,
      accountType: profile.accountType,
      profilePictureUrl: profile.profilePictureUrl,
      groupName: group.ok && group.value !== null ? group.value : undefined,
      accessToken: token.accessToken,
      expiresAt: token.expiresAt,
    });
  } catch {
    return to('save_failed');
  }
  return { redirect: `/accounts?connected=${encodeURIComponent(profile.username)}` };
}
```

Careful with the new-account/no-group case: `groupName: undefined` for a *new* account means `connectAccount` inserts `groupName ?? null` → isolated (already covered by Task 2). Run `npx vitest run tests/connect-flow.test.ts` → PASS.

- [ ] **Step 3: Route handlers and `assertOwner`**

`lib/auth/assert-owner.ts`:

```ts
import { getSessionInfo } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';

/** True only for a signed-in session that has completed 2FA when 2FA is enrolled. */
export async function assertOwner(): Promise<boolean> {
  try {
    const info = await getSessionInfo(await createServerSupabase());
    return info.signedIn && (!info.mfaRequired || info.aal === 'aal2');
  } catch {
    return false;
  }
}
```

`app/api/instagram/connect/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { normalizeGroup } from '@/lib/accounts/group';
import { assertOwner } from '@/lib/auth/assert-owner';
import { EnvError, getInstagramEnv } from '@/lib/env';
import { buildAuthorizeUrl } from '@/lib/instagram/oauth';
import { STATE_COOKIE, STATE_MAX_AGE_SECONDS, newOAuthState } from '@/lib/instagram/state';

export async function GET(request: NextRequest) {
  if (!(await assertOwner())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let cfg;
  try {
    cfg = getInstagramEnv();
  } catch (e) {
    if (e instanceof EnvError) return NextResponse.redirect(new URL('/accounts?error=not_configured', request.url));
    throw e;
  }
  const g = normalizeGroup(request.nextUrl.searchParams.get('group'));
  const { state, cookie } = newOAuthState(g.ok ? g.value : null);
  const res = NextResponse.redirect(buildAuthorizeUrl(cfg, state));
  res.cookies.set(STATE_COOKIE, cookie, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/api/instagram', maxAge: STATE_MAX_AGE_SECONDS });
  return res;
}
```

`app/api/instagram/callback/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import { assertOwner } from '@/lib/auth/assert-owner';
import { EnvError, getInstagramEnv } from '@/lib/env';
import { processCallback } from '@/lib/instagram/connect-flow';
import { STATE_COOKIE } from '@/lib/instagram/state';
import { createAdminSupabase } from '@/lib/supabase/admin';

export async function GET(request: NextRequest) {
  if (!(await assertOwner())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const q = request.nextUrl.searchParams;
  let redirect: string;
  try {
    const result = await processCallback(
      { code: q.get('code'), state: q.get('state'), error: q.get('error'), cookie: request.cookies.get(STATE_COOKIE)?.value },
      { cfg: getInstagramEnv(), store: supabaseAccountsStore(createAdminSupabase()) },
    );
    redirect = result.redirect;
  } catch (e) {
    redirect = e instanceof EnvError ? '/accounts?error=not_configured' : '/accounts?error=save_failed';
  }
  const res = NextResponse.redirect(new URL(redirect, request.url));
  res.cookies.set(STATE_COOKIE, '', { path: '/api/instagram', maxAge: 0 }); // single use
  return res;
}
```

`app/api/instagram/deauthorize/route.ts` and `delete/route.ts` (shared logic in the test below; implement each as):

```ts
import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { markNeedsReconnect } from '@/lib/accounts/service';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import { EnvError, getInstagramEnv } from '@/lib/env';
import { parseSignedRequest } from '@/lib/instagram/signed-request';
import { createAdminSupabase } from '@/lib/supabase/admin';

export async function POST(request: NextRequest) {
  let secret: string;
  try {
    secret = getInstagramEnv().appSecret;
  } catch (e) {
    if (e instanceof EnvError) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    throw e;
  }
  const form = await request.formData().catch(() => null);
  const signed = form?.get('signed_request');
  const parsed = typeof signed === 'string' ? parseSignedRequest(signed, secret) : null;
  if (!parsed) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  await markNeedsReconnect(supabaseAccountsStore(createAdminSupabase()), parsed.userId, 'deauthorized');
  return NextResponse.json({});
}
```

For `delete/route.ts` the same, but the success response is `NextResponse.json({ url: \`${process.env.NEXT_PUBLIC_APP_URL ?? ''}/accounts\`, confirmation_code: randomBytes(8).toString('hex') })` and the reason string is `'deletion requested'`. (Meta only needs a URL and code back; the owner's data is deliberately **not** deleted automatically — the account is flagged and the owner can archive/delete it in the app.)

- [ ] **Step 4: Write the route tests** — `tests/instagram-routes.test.ts` (node environment; mock `@/lib/auth/assert-owner`, `@/lib/supabase/admin`, `@/lib/accounts/supabase-store`, and set env via `vi.stubEnv`):

```ts
// @vitest-environment node
import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const owner = { ok: true };
const marked: [string, string][] = [];
vi.mock('@/lib/auth/assert-owner', () => ({ assertOwner: async () => owner.ok }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => ({}) }));
vi.mock('@/lib/accounts/supabase-store', () => ({ supabaseAccountsStore: () => ({ __fake: true }) }));
vi.mock('@/lib/accounts/service', async (orig) => ({ ...(await orig<object>()), markNeedsReconnect: async (_s: unknown, id: string, why: string) => void marked.push([id, why]) }));

import { GET as connect } from '@/app/api/instagram/connect/route';
import { GET as callback } from '@/app/api/instagram/callback/route';
import { POST as deauthorize } from '@/app/api/instagram/deauthorize/route';
import { POST as del } from '@/app/api/instagram/delete/route';
import { STATE_COOKIE } from '@/lib/instagram/state';

const ORIGIN = 'https://app.test';
beforeEach(() => {
  owner.ok = true;
  marked.length = 0;
  vi.stubEnv('IG_APP_ID', '1234567890');
  vi.stubEnv('IG_APP_SECRET', 'app-secret-123');
  vi.stubEnv('IG_REDIRECT_URI', `${ORIGIN}/api/instagram/callback`);
  vi.stubEnv('NEXT_PUBLIC_APP_URL', ORIGIN);
});
afterEach(() => vi.unstubAllEnvs());

const get = (path: string, cookie?: string) => new NextRequest(new URL(path, ORIGIN), { headers: cookie ? { cookie } : {} });
const b64u = (s: string) => Buffer.from(s).toString('base64url');
const signed = (payload: object, secret = 'app-secret-123') => {
  const p = b64u(JSON.stringify(payload));
  return `${createHmac('sha256', secret).update(p).digest('base64url')}.${p}`;
};
const post = (route: typeof deauthorize, value?: string) => {
  const fd = new FormData();
  if (value !== undefined) fd.set('signed_request', value);
  return route(new NextRequest(new URL('/x', ORIGIN), { method: 'POST', body: fd }));
};

describe('GET /api/instagram/connect', () => {
  it('is 401 for a visitor who is not the owner', async () => {
    owner.ok = false;
    expect((await connect(get('/api/instagram/connect'))).status).toBe(401);
  });

  it('redirects to Instagram with a state, sets the httpOnly state cookie, and carries the group in the cookie only', async () => {
    const res = await connect(get('/api/instagram/connect?group=Brand%20X'));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.origin + loc.pathname).toBe('https://www.instagram.com/oauth/authorize');
    expect(loc.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(loc.searchParams.get('scope')).toBe('instagram_business_basic,instagram_business_manage_insights');
    expect(loc.toString()).not.toContain('Brand');
    const c = res.cookies.get(STATE_COOKIE)!;
    expect(c.value).toBeTruthy();
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    expect(res.headers.get('set-cookie')).toMatch(/SameSite=lax/i);
    expect(res.headers.get('set-cookie')).toMatch(/Path=\/api\/instagram/i);
  });

  it('an invalid group is ignored, not an error', async () => {
    expect((await connect(get('/api/instagram/connect?group=' + 'x'.repeat(80)))).status).toBe(307);
  });

  it('without Instagram configuration it goes back to /accounts with not_configured', async () => {
    vi.stubEnv('IG_APP_ID', '');
    const res = await connect(get('/api/instagram/connect'));
    expect(new URL(res.headers.get('location')!).pathname + new URL(res.headers.get('location')!).search).toBe('/accounts?error=not_configured');
  });
});

describe('GET /api/instagram/callback', () => {
  it('is 401 for a visitor who is not the owner', async () => {
    owner.ok = false;
    expect((await callback(get('/api/instagram/callback?code=c&state=s'))).status).toBe(401);
  });

  it('a callback with no matching state cookie redirects to state_mismatch and clears the cookie', async () => {
    const res = await callback(get('/api/instagram/callback?code=c&state=s', `${STATE_COOKIE}=garbage`));
    const loc = new URL(res.headers.get('location')!);
    expect(loc.pathname + loc.search).toBe('/accounts?error=state_mismatch');
    expect(res.headers.get('set-cookie')).toMatch(new RegExp(`${STATE_COOKIE}=;`));
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
  });

  it('redirects stay on our own origin', async () => {
    const res = await callback(get('/api/instagram/callback?error=access_denied&state=x'));
    expect(new URL(res.headers.get('location')!).origin).toBe(ORIGIN);
  });
});

describe('Meta callbacks', () => {
  it('deauthorize: a valid signed_request flags the account', async () => {
    const res = await post(deauthorize, signed({ algorithm: 'HMAC-SHA256', user_id: '1784' }));
    expect(res.status).toBe(200);
    expect(marked).toEqual([['1784', 'deauthorized']]);
  });

  it('delete: a valid signed_request answers with a status url and a confirmation code', async () => {
    const res = await post(del, signed({ algorithm: 'HMAC-SHA256', user_id: '1784' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe(`${ORIGIN}/accounts`);
    expect(body.confirmation_code).toMatch(/^[0-9a-f]{16}$/);
    expect(marked).toEqual([['1784', 'deletion requested']]);
  });

  it.each([
    ['missing', undefined],
    ['garbage', 'not.a.signed.request'],
    ['wrong secret', signed({ algorithm: 'HMAC-SHA256', user_id: '1784' }, 'other-secret')],
    ['wrong algorithm', signed({ algorithm: 'HMAC-SHA1', user_id: '1784' })],
    ['no user id', signed({ algorithm: 'HMAC-SHA256' })],
  ])('%s signed_request -> 400 and nothing changes', async (_n, value) => {
    for (const route of [deauthorize, del]) {
      const res = await post(route, value);
      expect(res.status).toBe(400);
    }
    expect(marked).toEqual([]);
  });

  it('a non-form body is a 400, not a crash', async () => {
    const res = await deauthorize(new NextRequest(new URL('/x', ORIGIN), { method: 'POST', body: 'plain text' }));
    expect(res.status).toBe(400);
  });

  it('without the app secret configured the callbacks answer 503 and change nothing', async () => {
    vi.stubEnv('IG_APP_SECRET', '');
    expect((await post(deauthorize, signed({ algorithm: 'HMAC-SHA256', user_id: '1' }))).status).toBe(503);
    expect(marked).toEqual([]);
  });
});
```

Run `npx vitest run tests/connect-flow.test.ts tests/instagram-routes.test.ts` → PASS. (Adjust the mock of `service` only if the module path or the way vitest hoists `vi.mock` needs it; the assertions are the contract.)

- [ ] **Step 5: Verify and commit**

Run: `npm run lint && npm run typecheck && npm test && npm run build`. The build lists the four `/api/instagram/*` routes.

```bash
git add lib/auth/assert-owner.ts lib/instagram/connect-flow.ts app/api/instagram tests/connect-flow.test.ts tests/instagram-routes.test.ts
git commit -m "feat: Instagram connect flow, owner-guarded OAuth routes and Meta deauthorize/delete callbacks" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Account server actions

**Files:**
- Create: `app/(app)/accounts/actions.ts`, `tests/account-actions.test.ts`

**Interfaces:**
- Consumes: `assertOwner`, service functions, `supabaseAccountsStore(createAdminSupabase())`, `revalidatePath`.
- Produces (all `'use server'`, all return `Promise<{ ok: true } | { ok: false; error: string }>`): `archiveAccountAction(id)`, `restoreAccountAction(id)`, `deleteAccountAction(id)`, `setGroupAction(id, group)`. Each: `String()`-coerces inputs; not owner → `{ ok: false, error: 'unauthorized' }` **before** touching the store; service error codes pass through (`not_found`, `not_archived`, `invalid_group`); unexpected exceptions → `{ ok: false, error: 'unexpected' }` (no message); success → `revalidatePath('/accounts')`.

- [ ] **Step 1: Write the failing test** — `tests/account-actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = { ok: true };
const calls: string[] = [];
const service = {
  archiveAccount: vi.fn(async () => ({ ok: true as const })),
  restoreAccount: vi.fn(async () => ({ ok: true as const })),
  deleteAccountPermanently: vi.fn(async () => ({ ok: true as const })),
  setAccountGroup: vi.fn(async () => ({ ok: true as const })),
};
vi.mock('@/lib/auth/assert-owner', () => ({ assertOwner: async () => owner.ok }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => (calls.push('admin'), {}) }));
vi.mock('@/lib/accounts/supabase-store', () => ({ supabaseAccountsStore: () => ({ __fake: true }) }));
vi.mock('@/lib/accounts/service', () => service);
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => calls.push(`revalidate:${p}`) }));

import { archiveAccountAction, deleteAccountAction, restoreAccountAction, setGroupAction } from '@/app/(app)/accounts/actions';

beforeEach(() => {
  owner.ok = true;
  calls.length = 0;
  for (const f of Object.values(service)) f.mockClear();
});

const cases = [
  ['archive', (id: string) => archiveAccountAction(id), 'archiveAccount'],
  ['restore', (id: string) => restoreAccountAction(id), 'restoreAccount'],
  ['delete', (id: string) => deleteAccountAction(id), 'deleteAccountPermanently'],
  ['setGroup', (id: string) => setGroupAction(id, 'G'), 'setAccountGroup'],
] as const;

describe.each(cases)('%s action', (_name, run, fn) => {
  it('refuses a non-owner before touching the admin client or the service', async () => {
    owner.ok = false;
    expect(await run('a1')).toEqual({ ok: false, error: 'unauthorized' });
    expect(calls).not.toContain('admin');
    expect(service[fn]).not.toHaveBeenCalled();
  });

  it('runs the service and revalidates /accounts on success', async () => {
    expect(await run('a1')).toEqual({ ok: true });
    expect(service[fn]).toHaveBeenCalledTimes(1);
    expect(calls).toContain('revalidate:/accounts');
  });

  it('passes service error codes through without revalidating', async () => {
    (service[fn] as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({ ok: false, error: 'not_found' });
    expect(await run('a1')).toEqual({ ok: false, error: 'not_found' });
    expect(calls).not.toContain('revalidate:/accounts');
  });

  it('an unexpected exception becomes a generic error with no message', async () => {
    (service[fn] as unknown as { mockRejectedValueOnce: (v: unknown) => void }).mockRejectedValueOnce(new Error('db password hunter2'));
    const r = await run('a1');
    expect(r).toEqual({ ok: false, error: 'unexpected' });
    expect(JSON.stringify(r)).not.toContain('hunter2');
  });

  it('coerces a non-string id', async () => {
    await (run as (id: unknown) => Promise<unknown>)({ toString: () => 'a9' });
    expect((service[fn].mock.calls[0] as unknown[])[1]).toBe('a9');
  });
});

describe('setGroupAction', () => {
  it('forwards the raw group so the service can validate/normalise it', async () => {
    await setGroupAction('a1', '  Brand  X ');
    expect(service.setAccountGroup.mock.calls[0][2]).toBe('  Brand  X ');
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement `app/(app)/accounts/actions.ts`**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { archiveAccount, deleteAccountPermanently, restoreAccount, setAccountGroup } from '@/lib/accounts/service';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import { assertOwner } from '@/lib/auth/assert-owner';
import { createAdminSupabase } from '@/lib/supabase/admin';
import type { AccountsStore } from '@/lib/accounts/types';

type Result = { ok: true } | { ok: false; error: string };

async function guarded(run: (store: AccountsStore) => Promise<Result>): Promise<Result> {
  if (!(await assertOwner())) return { ok: false, error: 'unauthorized' };
  try {
    const result = await run(supabaseAccountsStore(createAdminSupabase()));
    if (result.ok) revalidatePath('/accounts');
    return result;
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}

export async function archiveAccountAction(id: string): Promise<Result> {
  return guarded((s) => archiveAccount(s, String(id)));
}
export async function restoreAccountAction(id: string): Promise<Result> {
  return guarded((s) => restoreAccount(s, String(id)));
}
export async function deleteAccountAction(id: string): Promise<Result> {
  return guarded((s) => deleteAccountPermanently(s, String(id)));
}
export async function setGroupAction(id: string, group: string | null): Promise<Result> {
  return guarded((s) => setAccountGroup(s, String(id), group));
}
```

Run `npx vitest run tests/account-actions.test.ts` → PASS.

- [ ] **Step 3: Verify and commit**

Run: `npm run lint && npm run typecheck && npm test`.

```bash
git add "app/(app)/accounts/actions.ts" tests/account-actions.test.ts
git commit -m "feat: owner-guarded account server actions (archive, restore, delete, group)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Accounts page and components

**Files:**
- Create: `components/accounts/StatusBadge.tsx`, `components/accounts/TokenMeter.tsx`, `components/accounts/ConnectDialog.tsx`, `components/accounts/GroupDialog.tsx`, `components/accounts/AccountsView.tsx`, `tests/accounts-view.test.tsx`, `tests/connect-dialog.test.tsx`
- Modify: `app/(app)/accounts/page.tsx` (replace the placeholder), `messages/en.json`, `messages/zh-CN.json`

**Interfaces:**
- Consumes: `StoredAccount` (Task 2), `tokenStatus`, `formatDate` + `usePrefs` (Plan 1), Plan 2 components (`ResponsiveDialog*`, `AlertDialog*`, `Table*`, `Badge`, `Progress`, `DropdownMenu*`, `Button`, `Input`, `Card`, `Alert`, `FormField`, `EmptyState`, `PageHeader`), the actions from Task 7.
- Produces:
  - `StatusBadge({ status, token })` where `token` is `ReturnType<typeof tokenStatus>['state']`: Archived → "Archived"; `needs_reconnect` or `expired` → "Reconnect"; `expiring` → "Expiring"; else "Active"; each with an icon/dot **and** text (never colour only).
  - `TokenMeter({ expiresAt, now })`: `Progress` (value = `min(100, daysLeft / 60 * 100)`) with `aria-label`, and "N days left" / "Expired" / "—" text.
  - `ConnectDialog({ groups, trigger, defaultGroup? })` — `ResponsiveDialog`; a group `Input` with `<datalist>` of existing groups (optional, max 40 chars) and a primary action that is a **link** `<a href={`/api/instagram/connect${group ? `?group=${encodeURIComponent(group)}` : ''}`}>` labelled "Continue with Instagram"; includes the notes: *Creator or Business account required*, *you'll log in on Instagram's own page*, *read-only access*.
  - `GroupDialog({ account, groups, onSave })` — edit an account's group.
  - `AccountsView({ accounts, actions, notice })` where `actions: { archive(id), restore(id), remove(id), setGroup(id, group) }` (each returns `{ ok: boolean; error?: string }`) and `notice?: { connected?: string; error?: string }`. Renders: page header with *Add account* (opens `ConnectDialog`); a notice `Alert` (success "Connected @name" / destructive per error key); accounts **grouped by group name** (isolated accounts under "Isolated accounts"), each group a section heading with a count; a table (≥ md) and a card list (< md) of the same rows showing avatar initial, `@username`, group `Badge`, `TokenMeter`, `StatusBadge`, last connected date via `formatDate`; row menu: Edit group, Reconnect (link to `/api/instagram/connect?group=<current>`), Archive (AlertDialog); an *Archived* `<details>` section listing archived accounts with Restore and *Delete permanently* (AlertDialog requiring the user to type the `@username` exactly before the confirm button enables); `EmptyState` when there are no accounts at all. All strings via next-intl; group names and usernames rendered as text (React escapes them).
  - `app/(app)/accounts/page.tsx` (server): reads `searchParams` (`connected`, `error`) — only known error keys are shown (`access_denied`, `state_mismatch`, `missing_code`, `exchange_failed`, `profile_failed`, `not_professional`, `save_failed`, `not_configured`; anything else is ignored) — loads accounts with the **owner's session** client (`createServerSupabase` + `supabaseAccountsStore(...).list()`; RLS applies), wraps the Task 7 actions, and renders `AccountsView`.
- New message namespace `accounts` (both catalogs). Keys and text (en / zh-CN): `title` "Accounts" / "账号"; `subtitle` "Connect, group and monitor your Instagram accounts" / "连接、分组并监控你的 Instagram 账号"; `add` "Add account" / "添加账号"; `isolated` "Isolated accounts" / "独立账号"; `archivedTitle` "Archived ({count})" / "已归档({count})"; `connectedAs` "Connected {username}" / "已连接 {username}"; `empty` "No accounts yet" / "还没有账号"; `emptyHint` "Connect an Instagram account to start collecting insights." / "连接一个 Instagram 账号即可开始收集数据洞察。"; `columns.account` "Account" / "账号", `columns.group` "Group" / "分组", `columns.token` "Token" / "令牌", `columns.status` "Status" / "状态", `columns.connected` "Connected" / "连接时间"; `status.active` "Active" / "正常", `status.expiring` "Expiring" / "即将过期", `status.reconnect` "Reconnect" / "需重连", `status.archived` "Archived" / "已归档"; `token.daysLeft` "{days} days left" / "剩余 {days} 天", `token.expired` "Expired" / "已过期", `token.unknown` "—" / "—", `token.label` "Token validity" / "令牌有效期"; `menu.open` "Account actions" / "账号操作", `menu.editGroup` "Edit group" / "修改分组", `menu.reconnect` "Reconnect" / "重新连接", `menu.archive` "Archive" / "归档", `menu.restore` "Restore" / "恢复", `menu.delete` "Delete permanently" / "永久删除"; `connect.title` "Add an Instagram account" / "添加 Instagram 账号", `connect.group` "Group (optional)" / "分组(可选)", `connect.groupHint` "Leave empty to keep the account isolated." / "留空则作为独立账号。", `connect.notes` "Creator or Business accounts only. You'll log in on Instagram's own page and approve read-only access." / "仅支持创作者或商业账号。你将在 Instagram 官方页面登录并授予只读权限。", `connect.continue` "Continue with Instagram" / "使用 Instagram 继续", `connect.cancel` "Cancel" / "取消"; `group.title` "Edit group" / "修改分组", `group.save` "Save" / "保存"; `archive.title` "Archive @{username}?" / "归档 @{username}?", `archive.body` "Syncing stops and the account is hidden. Its history is kept, and reconnecting restores it." / "将停止同步并隐藏该账号,历史数据会保留,重新连接即可恢复。", `archive.confirm` "Archive" / "归档"; `delete.title` "Delete @{username} permanently?" / "永久删除 @{username}?", `delete.body` "All collected history for this account will be erased. This cannot be undone. Type the username to confirm." / "该账号已收集的所有历史数据都将被清除,且无法恢复。请输入用户名以确认。", `delete.confirm` "Delete permanently" / "永久删除", `delete.cancel` "Cancel" / "取消"; `errors.access_denied` "Instagram access was not granted." / "未获得 Instagram 授权。", `errors.state_mismatch` "The sign-in session expired. Please try again." / "登录会话已过期,请重试。", `errors.missing_code` "Instagram did not return a login code. Try again." / "Instagram 未返回登录凭证,请重试。", `errors.exchange_failed` "Instagram rejected the login. Try again." / "Instagram 拒绝了登录,请重试。", `errors.profile_failed` "Couldn't read the account profile. Try again." / "无法读取账号资料,请重试。", `errors.not_professional` "That account is not a Creator or Business account. Switch it in Instagram first." / "该账号不是创作者或商业账号,请先在 Instagram 中切换。", `errors.save_failed` "Couldn't save the account. Try again." / "无法保存账号,请重试。", `errors.not_configured` "Instagram isn't configured yet. See docs/META_SETUP.md." / "尚未配置 Instagram。请参阅 docs/META_SETUP.md。", `errors.unauthorized` "You are not allowed to do that." / "你没有执行此操作的权限。", `errors.unexpected` "Something went wrong. Please try again." / "出了点问题,请重试。", `errors.invalid_group` "That group name is not valid (max 40 characters)." / "分组名称无效(最多 40 个字符)。", `errors.not_found` "That account no longer exists." / "该账号已不存在。", `errors.not_archived` "Only archived accounts can do that." / "只有已归档的账号才能执行此操作。".

- [ ] **Step 1: Messages** — add the namespace to both catalogs; parity test green.

- [ ] **Step 2: Write the failing component tests** — `tests/accounts-view.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { AccountsView } from '@/components/accounts/AccountsView';
import type { StoredAccount } from '@/lib/accounts/types';
import { DEFAULT_PREFS } from '@/lib/prefs';

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const acct = (o: Partial<StoredAccount> & { id: string; username: string }): StoredAccount => ({
  igUserId: o.id, displayName: null, accountType: 'Media_Creator', profilePictureUrl: null, groupName: null, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: inDays(54), connectedAt: '2026-10-02T00:00:00Z', ...o,
});
const accounts = [
  acct({ id: '1', username: 'brandx.official', groupName: 'Brand X' }),
  acct({ id: '2', username: 'brandx.shop', groupName: 'Brand X', tokenExpiresAt: inDays(5) }),
  acct({ id: '3', username: 'old.account', status: 'needs_reconnect', tokenExpiresAt: inDays(-1) }),
  acct({ id: '4', username: 'gone', status: 'archived', archivedAt: '2026-10-10T00:00:00Z', groupName: 'Brand X' }),
];

const ok = async () => ({ ok: true });
function setup(props: Partial<React.ComponentProps<typeof AccountsView>> = {}, locale: 'en' | 'zh-CN' = 'en') {
  const actions = { archive: vi.fn(ok), restore: vi.fn(ok), remove: vi.fn(ok), setGroup: vi.fn(ok) };
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        <AccountsView accounts={accounts} actions={actions} {...props} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
  return actions;
}

describe('AccountsView', () => {
  it('groups accounts under their group name, isolated ones separately, archived ones in a collapsed section', () => {
    setup();
    expect(screen.getByRole('heading', { name: /Brand X/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Isolated accounts/ })).toBeInTheDocument();
    expect(screen.getAllByText('@brandx.official').length).toBeGreaterThan(0);
    const archived = screen.getByText(/Archived \(1\)/).closest('details')!;
    expect(archived).not.toHaveAttribute('open');
    expect(within(archived).getByText('@gone')).toBeInTheDocument();
  });

  it('shows status with text, not colour alone: Active, Expiring (5 days left) and Reconnect (expired)', () => {
    setup();
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Expiring').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Reconnect').length).toBeGreaterThan(0);
    expect(screen.getAllByText('5 days left').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Expired').length).toBeGreaterThan(0);
  });

  it('archiving needs a confirmation, then calls the action with the id', async () => {
    const actions = setup();
    await userEvent.click(screen.getAllByRole('button', { name: 'Account actions' })[0]);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    expect(actions.archive).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Archive @brandx.official?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    expect(actions.archive).toHaveBeenCalledWith('1');
  });

  it('restoring an archived account calls restore', async () => {
    const actions = setup();
    const archived = screen.getByText(/Archived \(1\)/).closest('details')!;
    archived.setAttribute('open', '');
    await userEvent.click(within(archived).getByRole('button', { name: 'Restore' }));
    expect(actions.restore).toHaveBeenCalledWith('4');
  });

  it('permanent delete stays disabled until the exact @username is typed', async () => {
    const actions = setup();
    const archived = screen.getByText(/Archived \(1\)/).closest('details')!;
    archived.setAttribute('open', '');
    await userEvent.click(within(archived).getByRole('button', { name: 'Delete permanently' }));
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'Delete permanently' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox'), '@gon');
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox'), 'e');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(actions.remove).toHaveBeenCalledWith('4');
  });

  it('editing the group saves the trimmed text through the action', async () => {
    const actions = setup();
    await userEvent.click(screen.getAllByRole('button', { name: 'Account actions' })[0]);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit group' }));
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, 'Personal');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(actions.setGroup).toHaveBeenCalledWith('1', 'Personal');
  });

  it('an action error is shown translated and the dialog stays usable', async () => {
    const actions = setup();
    actions.archive.mockResolvedValueOnce({ ok: false, error: 'unauthorized' } as never);
    await userEvent.click(screen.getAllByRole('button', { name: 'Account actions' })[0]);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('You are not allowed to do that.')).toBeInTheDocument();
  });

  it('renders hostile group names and usernames as inert text', () => {
    setup({ accounts: [acct({ id: '9', username: 'x', groupName: '<img src=x onerror=alert(1)>' })] });
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
  });

  it('shows the empty state with an add button when there are no accounts', () => {
    setup({ accounts: [] });
    expect(screen.getByText('No accounts yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add account' }).length).toBeGreaterThan(0);
  });

  it('shows a success notice for a fresh connection and a translated error for a failed one; unknown keys show nothing', () => {
    setup({ notice: { connected: 'brandx' } });
    expect(screen.getByRole('status')).toHaveTextContent('Connected @brandx');
  });
  it('error notice', () => {
    setup({ notice: { error: 'not_professional' } });
    expect(screen.getByRole('alert')).toHaveTextContent('not a Creator or Business account');
  });
  it('unknown error keys are ignored', () => {
    setup({ notice: { error: 'rm -rf' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders in Simplified Chinese', () => {
    setup({}, 'zh-CN');
    expect(screen.getByText('独立账号')).toBeInTheDocument();
    expect(screen.getAllByText('正常').length).toBeGreaterThan(0);
  });
});
```

`tests/connect-dialog.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import { ConnectDialog } from '@/components/accounts/ConnectDialog';

const open = async (props: Partial<React.ComponentProps<typeof ConnectDialog>> = {}) => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ConnectDialog groups={['Brand X', 'Personal']} trigger={<button>Open</button>} {...props} />
    </NextIntlClientProvider>,
  );
  await userEvent.click(screen.getByText('Open'));
  return screen.findByRole('dialog');
};

describe('ConnectDialog', () => {
  it('without a group the continue link goes straight to the connect route', async () => {
    await open();
    expect(screen.getByRole('link', { name: 'Continue with Instagram' })).toHaveAttribute('href', '/api/instagram/connect');
  });

  it('a typed group is URL-encoded into the link', async () => {
    await open();
    await userEvent.type(screen.getByLabelText('Group (optional)'), 'Brand & Co');
    expect(screen.getByRole('link', { name: 'Continue with Instagram' })).toHaveAttribute('href', '/api/instagram/connect?group=Brand%20%26%20Co');
  });

  it('offers the existing groups as suggestions', async () => {
    await open();
    const list = document.getElementById(screen.getByLabelText('Group (optional)').getAttribute('list')!)!;
    expect([...list.querySelectorAll('option')].map((o) => o.getAttribute('value'))).toEqual(['Brand X', 'Personal']);
  });

  it('caps the group at 40 characters', async () => {
    await open();
    expect(screen.getByLabelText('Group (optional)')).toHaveAttribute('maxlength', '40');
  });

  it('explains the requirements', async () => {
    await open();
    expect(screen.getByText(/Creator or Business accounts only/)).toBeInTheDocument();
  });

  it('a whitespace-only group is treated as no group', async () => {
    await open();
    await userEvent.type(screen.getByLabelText('Group (optional)'), '   ');
    expect(screen.getByRole('link', { name: 'Continue with Instagram' })).toHaveAttribute('href', '/api/instagram/connect');
  });
});
```

Run → FAIL.

- [ ] **Step 3: Implement the components and the page.** Build them from the Plan 2 kit as specified above (you choose the exact JSX; the tests are the contract). Required details:
  - `AccountsView` is a client component; it holds the dialog state (`pendingArchive`, `pendingDelete`, `editGroup`) and shows action errors translated via `useTranslations('accounts.errors')` (fall back to `errors.unexpected` for unknown codes). The `<details>` for archived accounts has no `open` attribute by default (the test sets it programmatically).
  - Row actions open dialogs from a `DropdownMenu` (`menu.open` is the trigger's `aria-label`); the *Reconnect* item is a link to `/api/instagram/connect` plus `?group=` when the account has one.
  - Dates use `formatDate(account.connectedAt, prefs)` with `prefs` from `usePrefs()`; "now" for `tokenStatus` is `new Date()` computed once per render via `useMemo`/`useState` initialiser — do **not** call `Date.now()` during render in a way that makes server and client markup differ in the first paint; compute it on the server in `page.tsx` and pass `nowIso` as a prop if hydration warnings appear (add an optional `now?: string` prop, defaulting to `new Date()`).
  - Notice `Alert`s: success uses `role="status"`, errors `role="alert"`; only keys in the known list render.
  - `page.tsx`: `searchParams` is a Promise in Next 16 (`const sp = await searchParams`); sanitise `connected` to a string ≤ 60 chars; `error` only if it is in the known-key list.
  Run the two new test files → PASS.

- [ ] **Step 4: Verify and commit**

Run: `npm run lint && npm run typecheck && npm test && npm run build`. Then do the visual check as in Plan 2 Task 6 Step 4 (production server on port 3120 — **stop only that PID** — the page needs login, so instead render the component through the styleguide: add a small `AccountsView` demo section with fake data to `app/styleguide/Gallery.tsx`, and screenshot `/styleguide` at 360 and 1280 widths; confirm the table/cards switch and nothing overflows).

```bash
git add components/accounts "app/(app)/accounts/page.tsx" app/styleguide messages tests/accounts-view.test.tsx tests/connect-dialog.test.tsx
git commit -m "feat: Accounts page (groups, status, token meter, connect/archive/restore/delete dialogs)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Runbook and docs

**Files:**
- Create: `docs/RUNBOOK_META.md`
- Modify: `docs/TODO.md`, `docs/META_SETUP.md` (one correction if needed), `CLAUDE.md` (nothing unless commands changed)

- [ ] **Step 1: Runbook** — `docs/RUNBOOK_META.md`: the live verification once `.env.local` (Supabase + `IG_*`), the Supabase project with both migrations applied (`20261014000001_…`, `20261014000002_…`; apply through the connected Supabase tool or `supabase db push`) and the Meta app exist: (1) `npm run check:env` all green; (2) deploy or run `npm run dev` on the URL registered as the redirect (Meta needs HTTPS — use the Vercel URL); (3) sign in (2FA), open **Accounts → Add account**, leave the group empty, click *Continue with Instagram*, log in as a **Creator** account, approve both permissions → land on `/accounts?connected=<username>`; the row shows *Active* and ~60 days; (4) repeat with a second account and the group "Brand X"; (5) negative checks: cancel on Instagram's screen → "Instagram access was not granted"; try a **personal** account → "not a Creator or Business account" and no row created; open `/api/instagram/callback?code=x&state=y` directly → "sign-in session expired"; (6) archive an account → it moves to *Archived*; reconnect it → same row restored (check in Supabase that `accounts.id` is unchanged and there is still exactly one row for its `ig_user_id`); delete permanently requires typing the username and removes the row and its `account_tokens` row; (7) in the Supabase SQL editor confirm `select count(*) from account_tokens` works with the secret key but a normal signed-in session cannot read it (RLS deny): run the security advisor; (8) send a forged `signed_request` with `curl -X POST -d signed_request=x <app>/api/instagram/deauthorize` → 400. Include the exact expected output for each step and a "what to send me if it fails" list (the redirect error key shown in the URL, never tokens).

- [ ] **Step 2: Docs** — `docs/TODO.md`: tick `lib/instagram.ts: authorize URL, code→token, long-lived exchange, refresh` (note: lives in `lib/instagram/oauth.ts`), `/accounts page + OAuth callback route`, `Archive / restore / permanent-delete for accounts`, each with "(code done; live verification pending — docs/RUNBOOK_META.md)"; leave `Verify with 1 real account, then connect all` unticked.

- [ ] **Step 3: Verify and commit**

Run: `npm run check`.

```bash
git add docs/RUNBOOK_META.md docs/TODO.md
git commit -m "docs: Meta live-verification runbook and TODO updates" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** Instagram Login OAuth with the exact scopes and Meta's documented endpoints ✔ (Task 4); long-lived token stored server-side, deny-all for the browser ✔ (Tasks 1, 3, 4); refresh function ready for the Plan 5 job ✔ (Task 4); multi-account via `force_reauth` ✔; optional groups, isolated accounts ✔ (Tasks 2, 8); remove = archive, reconnect restores the same row, permanent delete only on archived ✔ (Task 2); deauthorize/data-deletion callbacks with signed-request verification ✔ (Tasks 5-6); status/token expiry display ✔ (Task 8); owner-only everywhere ✔ (Tasks 6-7); i18n, responsive, kit components ✔ (Task 8). Out of scope here: token refresh job, sync (Plan 5), live verification (runbook).

**Placeholder scan:** none; Task 8's JSX is specified by interface + tests rather than pasted, which the reviewer checks against the tests and the mockup.

**Type consistency:** `AccountsStore`/`StoredAccount` (Task 2) used by Tasks 3, 6, 7, 8; `IgConfig` (Task 4) used by Task 6; `FormState`-style `{ ok, error }` result shape is the same across actions and the view's `actions` prop; message namespace `accounts.*` used in Task 8 only.

**Review Focus coverage:** #1 → `connect-flow.test` refusal table + route callback test + cookie cleared; #2 → `access_denied`, `not_professional` (personal and missing type), missing code, profile failure tests; #3 → service tests (restored same id, group kept, no duplicates, needs_reconnect→active, archived never resurrected, delete only archived) + SQL check constraint; #4 → leak tests in oauth, store and actions, redirect-shape test; #5 → signed-request unit tests + route 400 table; #6 → `normalizeGroup` tests + the XSS render test.
