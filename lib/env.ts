export class EnvError extends Error {
  constructor(public missing: string[]) {
    super(`Missing environment variables: ${missing.join(', ')}. See docs/SETUP.md.`);
    this.name = 'EnvError';
  }
}

const filled = (v: string | undefined): v is string => typeof v === 'string' && v.trim() !== '';

// Server/proxy only: reads process.env dynamically, which Next does not inline into browser bundles.
export function isSupabaseConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return filled(env.NEXT_PUBLIC_SUPABASE_URL) && filled(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

function need(values: Record<string, string | undefined>): Record<string, string> {
  const missing = Object.entries(values).filter(([, v]) => !filled(v)).map(([k]) => k);
  if (missing.length) throw new EnvError(missing);
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, (v as string).trim()]));
}

// NOTE: NEXT_PUBLIC_* must be referenced literally so Next can inline them into the browser bundle.
export function getPublicEnv() {
  const v = need({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });
  return { supabaseUrl: v.NEXT_PUBLIC_SUPABASE_URL, publishableKey: v.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, appUrl: v.NEXT_PUBLIC_APP_URL };
}

/** URL + publishable key only (no app URL): what the proxy and the Supabase clients need. */
export function getSupabasePublic() {
  const v = need({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  return { url: v.NEXT_PUBLIC_SUPABASE_URL, publishableKey: v.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY };
}

export function getServerEnv() {
  const v = need({ SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY, CRON_SECRET: process.env.CRON_SECRET });
  return { secretKey: v.SUPABASE_SECRET_KEY, cronSecret: v.CRON_SECRET };
}

/** Supabase URL alone (the admin client needs nothing else public). Literal reference so Next can inline it. */
export function getSupabaseUrl() {
  return need({ NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL }).NEXT_PUBLIC_SUPABASE_URL;
}

/** The secret key alone: the admin client must not depend on CRON_SECRET. */
export function getSupabaseSecretKey() {
  return need({ SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY }).SUPABASE_SECRET_KEY;
}
