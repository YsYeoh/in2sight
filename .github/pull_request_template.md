## What and why

<!-- What does this change, and why? Link the issue or plan. -->

## How I tested it

<!-- Commands run, screens checked. Say what you could NOT verify (for example against a real Instagram account). -->

## Checklist

- [ ] `npm run check` passes
- [ ] Analysis logic is a pure function in `lib/analysis/` with a test; sync and API code has a mocked-fetch test
- [ ] Every new UI string is in both `messages/en.json` and `messages/zh-CN.json`
- [ ] Only semantic tokens, and it looks right in all themes, light and dark, at 360 / 768 / 1280 px
- [ ] Database changes are a new migration file with row-level security
- [ ] No tokens, secrets or real follower or commenter data anywhere in the diff
- [ ] Docs updated (`docs/TODO.md`, the matching runbook)
- [ ] I used AI assistance: yes / no (if yes, I have read and tested the result)
