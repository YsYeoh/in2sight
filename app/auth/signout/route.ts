import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

/** Where requireOwner sends a signed-in non-owner: /login would bounce them straight back, so end the session first. */
export async function GET(request: Request) {
  const res = NextResponse.redirect(new URL('/login', request.url));
  const supabase = await createServerSupabase({ responseHeaders: res.headers });
  await supabase.auth.signOut();
  return res;
}
