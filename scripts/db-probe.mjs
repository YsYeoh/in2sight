// Anon-key existence probe: tells whether a table or an RPC function exists in the live database, using the PUBLIC key only
// (it never reads data). Usage (from the repo root):
//   node --env-file=.env.local scripts/db-probe.mjs table:follower_exports rpc:post_lab_latest:'{"p_ids":[]}'
// Reading the answer: 404 PGRST205 (table) / PGRST202 (function) = does not exist; 401 with code 42501 = exists and anon is denied (what
// we want for owner-only objects). PITFALL: a PostgREST RPC with required parameters answers 404 PGRST202 to a call with a wrong or empty
// body whether or not it exists: pass the REAL argument names (copy them from the migration).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  console.log('missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (run with node --env-file=.env.local)');
  process.exit(1);
}
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const code = async (res) => {
  try {
    return (await res.json()).code ?? '';
  } catch {
    return '';
  }
};
for (const arg of process.argv.slice(2)) {
  const [kind, name, ...rest] = arg.split(':');
  if (kind === 'table') {
    const res = await fetch(`${url}/rest/v1/${encodeURIComponent(name)}?select=*&limit=0`, { headers });
    console.log(`table ${name}: HTTP ${res.status} ${await code(res)}`);
  } else if (kind === 'rpc') {
    const res = await fetch(`${url}/rest/v1/rpc/${encodeURIComponent(name)}`, { method: 'POST', headers, body: rest.join(':') || '{}' });
    console.log(`rpc ${name}: HTTP ${res.status} ${await code(res)}`);
  } else {
    console.log(`unknown probe "${arg}" (use table:NAME or rpc:NAME:JSON)`);
  }
}
