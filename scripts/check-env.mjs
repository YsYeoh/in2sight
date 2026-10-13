// Checks that .env.local is filled in and well-formed. Never prints a value.
//   npm run check:env                 -> all required groups
//   npm run check:env -- --only=supabase,app
import { pathToFileURL } from 'node:url';

const PLACEHOLDER = /^(your[-_ ]|<.*>$|x{4,}$|changeme|todo|replace)/i;
const present = (v) => typeof v === 'string' && v.trim() !== '';
const longEnough = (n) => (v) => (v.length >= n ? null : `must be at least ${n} characters (got ${v.length}) — generate one, see docs/SETUP.md`);
const matches = (re, msg) => (v) => (re.test(v) ? null : msg);

/** Each rule: [name, validate(value, env) -> null | problem message]. Messages never contain the value. */
export const GROUPS = {
  app: {
    required: true,
    vars: [
      ['NEXT_PUBLIC_APP_URL', matches(/^(https:\/\/[^\s/]+|http:\/\/localhost(:\d+)?)$/, 'must be https://your-domain (no trailing slash), or http://localhost:3000 for local work')],
    ],
  },
  supabase: {
    required: true,
    vars: [
      ['NEXT_PUBLIC_SUPABASE_URL', matches(/^https:\/\/[a-z0-9]+\.supabase\.co$/, 'must look like https://<project-ref>.supabase.co (no trailing slash)')],
      [
        'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
        (v) => (v.startsWith('sb_secret_') ? 'this is a SECRET key — use the publishable key here (sb_publishable_…)' : /^(sb_publishable_|eyJ)/.test(v) ? null : 'must start with sb_publishable_ (or eyJ for a legacy anon key)'),
      ],
      [
        'SUPABASE_SECRET_KEY',
        (v, env) =>
          v.startsWith('sb_publishable_')
            ? 'this is the PUBLISHABLE key — the secret key (sb_secret_…) goes here'
            : v === env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
              ? 'must differ from the publishable key'
              : /^(sb_secret_|eyJ)/.test(v)
                ? null
                : 'must start with sb_secret_ (or eyJ for a legacy service_role key)',
      ],
    ],
  },
  security: {
    required: true,
    vars: [['CRON_SECRET', longEnough(32)]],
  },
  meta: {
    required: true,
    vars: [
      ['IG_APP_ID', matches(/^\d{10,20}$/, 'must be the numeric Instagram app ID (not the Meta app ID, not the secret)')],
      ['IG_APP_SECRET', matches(/^[a-f0-9]{32}$/i, 'must be the 32-character Instagram app secret')],
      [
        'IG_REDIRECT_URI',
        (v, env) => (v === `${env.NEXT_PUBLIC_APP_URL}/api/instagram/callback` ? null : 'must equal NEXT_PUBLIC_APP_URL + /api/instagram/callback exactly (Meta compares it character for character)'),
      ],
    ],
  },
  // optional groups: only validated once something is filled in
  push: {
    required: false,
    vars: [
      ['NEXT_PUBLIC_VAPID_PUBLIC_KEY', matches(/^[A-Za-z0-9_-]{80,}$/, 'must be the VAPID public key from `npx web-push generate-vapid-keys`')],
      ['VAPID_PRIVATE_KEY', matches(/^[A-Za-z0-9_-]{40,}$/, 'must be the VAPID private key from `npx web-push generate-vapid-keys`')],
      ['VAPID_SUBJECT', matches(/^(mailto:\S+@\S+|https:\/\/\S+)$/, 'must be mailto:you@example.com or an https URL')],
    ],
  },
  report: {
    required: false,
    vars: [['REPORT_SIGNING_SECRET', longEnough(32)]],
  },
};

/** @returns {{group:string,name:string,ok:boolean,skipped?:boolean,problem?:string}[]} */
export function checkEnv(env, groups = Object.keys(GROUPS)) {
  const out = [];
  for (const group of groups) {
    const g = GROUPS[group];
    if (!g) throw new Error(`Unknown group "${group}". Known: ${Object.keys(GROUPS).join(', ')}`);
    for (const [name, validate] of g.vars) {
      const value = env[name];
      if (!present(value)) {
        out.push(g.required ? { group, name, ok: false, problem: 'missing' } : { group, name, ok: true, skipped: true });
      } else if (PLACEHOLDER.test(value.trim())) {
        out.push({ group, name, ok: false, problem: 'still a placeholder from .env.example' });
      } else {
        const problem = validate(value.trim(), env);
        out.push(problem ? { group, name, ok: false, problem } : { group, name, ok: true });
      }
    }
  }
  return out;
}

function main() {
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
  const results = checkEnv(process.env, only);
  let last = '';
  for (const r of results) {
    if (r.group !== last) console.log(`\n${r.group}${GROUPS[r.group].required ? '' : ' (optional)'}`);
    last = r.group;
    console.log(`  ${r.skipped ? '[--]' : r.ok ? '[ok]' : '[!!]'} ${r.name}${r.problem ? ` — ${r.problem}` : r.skipped ? ' — not set (fine for now)' : ''}`);
  }
  const bad = results.filter((r) => !r.ok);
  console.log(bad.length ? `\n${bad.length} problem(s). Fix them in .env.local and run again.` : '\nAll good.');
  process.exit(bad.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
