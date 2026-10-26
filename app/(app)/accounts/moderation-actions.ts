'use server';

// Comment moderation server actions (Plan 15d). Server actions are public endpoints: requireOwner() FIRST (outside
// try/catch: it redirects by throwing); lib/moderation/service.ts then validates every value and never throws. The
// OWNER-SESSION client carries RLS for every read and write; the admin client is created only inside token() to read
// this one account's token (account_tokens is service-role only) and never leaves the server.
import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/auth/require-owner';
import { getInstagramEnv } from '@/lib/env';
import { igModeration } from '@/lib/instagram/moderation';
import type { SpamKind } from '@/lib/moderation/rules';
import { deleteRule, moderate, saveWordRule, setAutoHide, setSpamRule, undoAction, type ModerationResult, type RuleResult, type ServiceDeps } from '@/lib/moderation/service';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseSyncStore } from '@/lib/sync/store';

async function deps(): Promise<ServiceDeps> {
  return {
    db: await createServerSupabase(),
    token: (accountId) => supabaseSyncStore(createAdminSupabase()).getToken(accountId),
    ig: igModeration(getInstagramEnv().apiVersion),
  };
}

function done<R extends { ok: boolean }>(r: R): R {
  if (r.ok) revalidatePath('/accounts/[id]', 'page');
  return r;
}

const UNEXPECTED = { ok: false as const, error: 'unexpected' as const };

export async function hideCommentAction(accountId: string, commentId: string, hide: boolean, requestId: string): Promise<ModerationResult> {
  await requireOwner();
  if (typeof hide !== 'boolean') return { ok: false, error: 'invalid' };
  try {
    return done(await moderate(await deps(), { kind: hide ? 'hide' : 'unhide', accountId, commentId, requestId }));
  } catch {
    return UNEXPECTED; // missing Instagram env (EnvError) or a client that could not be created
  }
}

export async function replyCommentAction(accountId: string, commentId: string, message: string, requestId: string): Promise<ModerationResult> {
  await requireOwner();
  try {
    return done(await moderate(await deps(), { kind: 'reply', accountId, commentId, requestId, message }));
  } catch {
    return UNEXPECTED;
  }
}

export async function deleteCommentAction(accountId: string, commentId: string, requestId: string): Promise<ModerationResult> {
  await requireOwner();
  try {
    return done(await moderate(await deps(), { kind: 'delete', accountId, commentId, requestId }));
  } catch {
    return UNEXPECTED;
  }
}

export async function undoModerationAction(accountId: string, logId: number, requestId: string): Promise<ModerationResult> {
  await requireOwner();
  try {
    return done(await undoAction(await deps(), { accountId, logId, requestId }));
  } catch {
    return UNEXPECTED;
  }
}

export async function saveWordRuleAction(accountId: string, pattern: string, wholeWord: boolean): Promise<RuleResult> {
  await requireOwner();
  try {
    return done(await saveWordRule(await createServerSupabase(), accountId, pattern, wholeWord));
  } catch {
    return UNEXPECTED;
  }
}

export async function setSpamRuleAction(accountId: string, kind: SpamKind, on: boolean): Promise<RuleResult> {
  await requireOwner();
  try {
    return done(await setSpamRule(await createServerSupabase(), accountId, kind, on));
  } catch {
    return UNEXPECTED;
  }
}

export async function deleteRuleAction(accountId: string, ruleId: string): Promise<RuleResult> {
  await requireOwner();
  try {
    return done(await deleteRule(await createServerSupabase(), accountId, ruleId));
  } catch {
    return UNEXPECTED;
  }
}

export async function setAutoHideAction(accountId: string, enabled: boolean): Promise<RuleResult> {
  await requireOwner();
  try {
    return done(await setAutoHide(await createServerSupabase(), accountId, enabled));
  } catch {
    return UNEXPECTED;
  }
}
