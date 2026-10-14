import { NextResponse, type NextRequest } from 'next/server';
import { markNeedsReconnect } from '@/lib/accounts/service';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import { EnvError, getInstagramEnv } from '@/lib/env';
import { parseSignedRequest } from '@/lib/instagram/signed-request';
import { createAdminSupabase } from '@/lib/supabase/admin';

// Called by Meta, not a browser: authenticated by the HMAC on signed_request, not by a session.
// The answer never says whether the user exists.
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
