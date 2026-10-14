import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { markNeedsReconnect } from '@/lib/accounts/service';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import { EnvError, getInstagramEnv } from '@/lib/env';
import { parseSignedRequest } from '@/lib/instagram/signed-request';
import { createAdminSupabase } from '@/lib/supabase/admin';

// Meta data-deletion callback, authenticated by the HMAC on signed_request. The owner's data is deliberately NOT
// deleted automatically: the account is flagged and the owner archives/deletes it in the app.
export async function POST(request: NextRequest) {
  let secret: string;
  try {
    secret = getInstagramEnv().appSecret;
  } catch (e) {
    if (e instanceof EnvError) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    throw e;
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return NextResponse.json({ error: 'not_configured' }, { status: 503 }); // Meta needs an absolute status url
  const form = await request.formData().catch(() => null);
  const signed = form?.get('signed_request');
  const parsed = typeof signed === 'string' ? parseSignedRequest(signed, secret) : null;
  if (!parsed) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  await markNeedsReconnect(supabaseAccountsStore(createAdminSupabase()), parsed.userId, 'deletion requested');
  return NextResponse.json({ url: `${appUrl}/accounts`, confirmation_code: randomBytes(8).toString('hex') });
}
