// Records real Instagram API responses as test fixtures AND re-verifies the metric names in lib/instagram/metrics.ts
// against a live account (docs/RUNBOOK_SYNC.md steps 3-4).
//   npm run record:fixtures
// Uses the first ACTIVE account's token (read with the secret key). Prints only fixture names, HTTP status and Meta
// error code/subcode. The token is never printed and is redacted from everything written to disk.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import * as M from '../lib/instagram/metrics.ts';

/** Deep-copies `value` with every occurrence of the token and every access_token=… query value replaced. */
export function redact(value, token) {
  let s = JSON.stringify(value);
  if (token) s = s.split(token).join('REDACTED');
  return JSON.parse(s.replace(/access_token=[^&"\\]*/g, 'access_token=REDACTED'));
}

const TEXT = { caption: 'REDACTED caption', username: 'redacted_user', name: 'Redacted Name', permalink: 'https://www.instagram.com/p/REDACTED/', profile_picture_url: 'https://example.invalid/profile.jpg' };
const isInsight = (o) => 'title' in o || 'values' in o || 'total_value' in o; // there `name` is a metric name, keep it

/**
 * Deep-copies `value` with identifying values replaced by stable placeholders (same input -> same output; types and
 * structure kept so the parsers still work): id / user_id (one shared map, so an id keeps matching itself), caption,
 * username, name, permalink, profile_picture_url, paging cursors and the ids in paging URLs. Metric values stay.
 */
export function redactIdentity(value) {
  const ids = new Map();
  const idFor = (v) => {
    const k = String(v);
    if (!ids.has(k)) ids.set(k, ids.size + 1);
    return typeof v === 'number' ? 1000 + ids.get(k) : `1800000000000${String(ids.get(k)).padStart(4, '0')}`;
  };
  const url = (u) => u.replace(/\/\d{6,}\//g, '/ID/').replace(/([?&](?:after|before)=)[^&]*/g, '$1REDACTED');
  const walk = (v, key, parent) => {
    if (Array.isArray(v)) return v.map((x) => walk(x, key, parent));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k, v)]));
    if (v === null || v === undefined) return v;
    if (key === 'id' && parent && isInsight(parent)) return String(v).replace(/^\d+(?=\/)/, 'ID'); // "1784/insights/reach/day"
    if (key === 'id' || key === 'user_id') return idFor(v);
    if (key === 'name' && parent && isInsight(parent)) return v;
    if (key === 'next' || key === 'previous') return typeof v === 'string' ? url(v) : v;
    if (key === 'before' || key === 'after') return 'REDACTED';
    if (key in TEXT && typeof v === 'string') return TEXT[key];
    return v;
  };
  return walk(value);
}

/** `<media id>/insights` -> `{media-id}/insights`: the _source line must not carry the id either. */
export const sourcePath = (path) => path.replace(/^\d+\//, '{media-id}/');

/** The calls the sync makes, in the shape lib/instagram/data.ts sends them. ids come from earlier responses. */
export function plan(ids, since, until) {
  const day = { metric_type: 'total_value', period: 'day', since, until };
  const calls = [
    ['me', 'me', { fields: M.PROFILE_FIELDS }],
    ['account-day', 'me/insights', { ...day, metric: M.ACCOUNT_DAY_METRICS.join(',') }],
    ['account-follows', 'me/insights', { ...day, metric: M.FOLLOWS_METRIC, breakdown: M.FOLLOWS_BREAKDOWN }],
    ['demographics-age-gender', 'me/insights', { metric: M.DEMOGRAPHICS_METRIC, period: 'lifetime', metric_type: 'total_value', timeframe: M.DEMOGRAPHICS_TIMEFRAME, breakdown: M.DEMOGRAPHIC_BREAKDOWNS.age_gender }],
    ['online-followers', 'me/insights', { metric: M.ONLINE_FOLLOWERS_METRIC, period: 'lifetime', since, until }],
    ['media-page-1', 'me/media', { fields: M.MEDIA_FIELDS, limit: 2 }],
    ['stories', 'me/stories', { fields: M.STORY_FIELDS }],
  ];
  if (ids.media) calls.push(['media-insights-feed', `${ids.media}/insights`, { metric: M.FEED_METRICS.join(',') }]);
  if (ids.story) {
    calls.push(['media-insights-story', `${ids.story}/insights`, { metric: M.STORY_METRICS.join(',') }]);
    calls.push(['story-navigation', `${ids.story}/insights`, { metric: M.STORY_NAVIGATION_METRIC, breakdown: M.STORY_NAVIGATION_BREAKDOWN }]);
  }
  return calls;
}

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const acc = await db.from('accounts').select('id,username').eq('status', 'active').limit(1).maybeSingle();
  if (!acc.data) throw new Error('no active account (connect one first)');
  const tok = await db.from('account_tokens').select('access_token').eq('account_id', acc.data.id).maybeSingle();
  const token = tok.data?.access_token;
  if (!token) throw new Error('no token for that account');
  const version = process.env.IG_API_VERSION?.trim() || 'v25.0';
  const dir = join(process.cwd(), 'tests/fixtures/instagram');
  const until = Math.floor(Date.now() / 86_400_000) * 86_400;
  const since = until - 86_400;
  const ids = {};
  console.log(`recording for @${acc.data.username} (API ${version})`);
  for (let i = 0; i < plan(ids, since, until).length; i++) {
    const [name, path, params] = plan(ids, since, until)[i]; // re-planned each step: ids fill in as responses arrive
    const u = new URL(`https://graph.instagram.com/${version}/${path}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
    u.searchParams.set('access_token', token);
    const res = await fetch(u);
    const body = await res.json().catch(() => ({}));
    if (name === 'media-page-1') ids.media = body.data?.[0]?.id;
    if (name === 'stories') ids.story = body.data?.[0]?.id;
    const out = { _source: `recorded ${new Date().toISOString().slice(0, 10)} from GET /${version}/${sourcePath(path)}`, ...redact(redactIdentity(body), token) };
    const file = res.ok ? `${name}.json` : `${name}.error.json`; // an error never overwrites a good fixture
    writeFileSync(join(dir, file), JSON.stringify(out, null, 2) + '\n');
    console.log(`${res.ok ? '[ok]' : '[!!]'} ${name} -> ${file} (HTTP ${res.status}${body.error ? `, code ${body.error.code}${body.error.error_subcode ? `/${body.error.error_subcode}` : ''}` : ''})`);
  }
  console.log('\nIdentifying values (ids, captions, handles, permalinks, pictures) are replaced by placeholders; skim the files anyway, then run npm test.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => {
  console.error(`failed: ${e.message}`); // our own messages only; they never contain the token
  process.exit(1);
});
