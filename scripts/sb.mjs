// Runs `npx supabase <args>` with the environment loaded from .env.local and masks every secret-looking value in the output.
// Usage (from the repo root):  node --env-file=.env.local scripts/sb.mjs migration list
//                              node --env-file=.env.local scripts/sb.mjs db push --dry-run
//                              node --env-file=.env.local scripts/sb.mjs db push --yes
// Credentials (SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD) stay in the process environment: never on a command line, never printed.
// The project is linked on this machine (supabase/.temp, git-ignored; ref in SUPABASE_PROJECT_REF). Never print the environment.
import { spawnSync } from 'node:child_process';

const secrets = Object.entries(process.env)
  .filter(([k, v]) => /PASSWORD|TOKEN|SECRET|KEY/i.test(k) && v && v.length >= 6)
  .map(([, v]) => v);
const mask = (s) => secrets.reduce((acc, v) => acc.split(v).join('***'), s);

const r = spawnSync('npx', ['supabase', ...process.argv.slice(2)], { env: process.env, encoding: 'utf8', shell: true, cwd: process.cwd() });
process.stdout.write(mask(r.stdout ?? ''));
process.stderr.write(mask(r.stderr ?? ''));
console.log(`\n[sb exit=${r.status}]`);
process.exit(r.status ?? 1);
