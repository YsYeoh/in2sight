# Runbook — Covers UI (Plan 13a)

Live checks for the owner (with the assistant). Nothing here has been verified on the live site yet: the UI was
checked in jsdom tests only (see the plan's "Dry-run result"). The covers themselves come from Plan 11b: run
docs/RUNBOOK_CAPTURE.md §6 first, so that some media have `cover_status = 'ok'`.

## 0. Deploy order

This plan adds **no migration**. It reads `media.cover_status` and `media.children_count`, which
`20261022000001_capture_v2b.sql` added (applied live on 2026-10-17), and serves images only through the existing route
`GET /api/media/[id]/cover`. Plan 12b's `20261024000001_explorer.sql` was applied live on 2026-10-19 (see
docs/HANDOVER.md); nothing in this plan calls it, but the Posts tab's Explorer links lead to the page that does.

Find test items in the Supabase SQL editor:

```sql
select a.username, m.media_type, m.cover_status, count(*)
  from media m join accounts a on a.id = m.account_id
 group by 1, 2, 3 order by 1, 2, 3;
-- a post without a cover, and an expired Story with one:
select id, account_id, media_type, posted_at from media where cover_status = 'unavailable' and media_type <> 'STORY' order by posted_at desc limit 3;
select id, account_id, posted_at from media where media_type = 'STORY' and cover_status = 'ok' and expires_at < now() order by posted_at desc limit 3;
```

## 1. Layout: 360 / 768 / 1280 × themes

Each theme (Ink, Sunset, Forest, Mono) in light and dark, DevTools device toolbar:

| Check | 360 | 768 | 1280 |
|---|---|---|---|
| Posts tab without `?view`: grid at 360, table at 768 and 1280; the Grid/Table toggle marks the view you see | | | |
| `?view=grid`: 2/3/4/6 tiles per row, no horizontal page scroll; `?view=table`: the table (cards at 360) | | | |
| Tile: 4:5 cover, format icon, play glyph on Reels, slide count on carousels, date, reach, engagement | | | |
| Badges and the "Expired" ribbon stay readable on light and dark photos, in light and dark mode | | | |
| Stories: one strip per day that scrolls sideways inside the page (no page scroll), 9:16 frames, numbers under each | | | |
| Drawer: bottom sheet at 360 (scrolls), dialog at 768/1280 (cover left, details right, fits the window height) | | | |
| Calendar month view: up to 3 covers per day cell; the day list (and the phone agenda) shows a cover per item | | | |

## 2. Cover states

1. A post with `cover_status = 'ok'`: a pulsing skeleton, then the image fades in; nothing jumps (the box keeps its size).
2. A post with `unavailable` (SQL above): the format icon, never a broken-image icon; a screen reader reads
   "<caption> (no cover available)".
3. `pending` (a new post before the covers job ran): the icon, "cover not saved yet"; after the next lane-2 run and a
   reload: the image.
4. An expired Story with a stored cover: the image with the "Expired" ribbon; an expired Story without one: the icon
   with the ribbon.
5. DevTools → Network, filter `cover`: covers load as they scroll into view (lazy); only `/api/media/<id>/cover`,
   200 with `Cache-Control: private, max-age=31536000, immutable`; no request at all for items without a stored cover.
6. Load error: in Storage, rename one stored cover object of an `ok` item, reload → the icon ("cover could not be
   loaded"), no broken image. Rename it back.

## 3. Drawer and keyboard

1. Tab to a tile, press Enter: the drawer opens with focus inside and Tab stays inside it; Esc closes it and focus is
   back on the same tile. The same from the small cover in the table's first column and from a Story frame.
2. Content: the cover, "Reel · <date time>" in YOUR timezone (Settings), the caption's first 80 characters, the
   numbers, tags with Edit (save a tag: it shows in the drawer and in the table's Tags column), "Open on Instagram"
   (new tab). Carousels say "N slides".
3. Stories: all six numbers and the views curve; a Story Instagram never measured says "Instagram shares Story
   insights from 5 viewers" and shows no numbers.
4. Screen reader (VoiceOver / NVDA): a tile reads "Details of Reel · <date time>, button"; the dialog reads its title
   and the caption.
5. Table view: the post title still opens the Explorer item (Plan 12b); the cover opens the drawer.

## 4. URL state

- The toggle writes `view=grid` / `view=table`; Back returns to the previous view; the Time Scope bar, the filters
  (Apply and Reset) keep it; switching keeps the posts on screen until the other view arrives (the top bar runs).
- A bad value (`?view=<x>`) is ignored (automatic view).

## 5. 1-year Calendar performance

1. Calendar → 1y (and "all"): day cells show the count chips only (no covers); the list under the grid shows covers
   for the selected day; the phone agenda lists every item with a lazy cover.
2. DevTools → Performance, reload `/calendar?from=1y`: note the time until the grid is interactive: ______ ms
   (Plan 13a) vs ______ ms (the commit before Plan 13a). Network: only the covers in view are requested.

## 6. Security

- Signed out (a private window): `https://<domain>/api/media/<media_id>/cover` → 401 JSON or a redirect to `/login`,
  never the image.
- Signed in: a made-up numeric id → 404; a non-numeric id → 404.
- View the page source / RSC payload of the Posts tab: no Storage keys, no signed URLs, no Instagram CDN URLs — only
  `/api/media/<id>/cover`.

## 7. Known limits (by design)

- Stories: the newest 200 per account per range (the tab says so); pick a shorter range for older ones.
- The drawer shows the caption's first 80 characters (the whole caption is in the Post Lab, Plan 13b).
- Calendar cells show covers only in month-sized views (≤ 6 weeks); the Calendar does not open the drawer.
- Only a carousel's first slide has a stored cover (Plan 11b).
- Covers are original size (50–150 KB): a 50-post grid loads up to a few MB once; afterwards the browser cache serves
  them (`immutable`).

## What to send if it fails

The URL, width, theme, a screenshot, the media id (never a Storage key or CDN URL) and the status code of
`/api/media/<id>/cover`.
