# Implementer rules (in2sight): read this fully before doing anything

Used by the orchestrator when it runs a plan task by task with parallel `isolation: "worktree"` agents (see docs/HANDOVER.md section 0, "How this was built"). Paste into each agent prompt: "First read docs/superpowers/implementer-rules.md and follow it exactly. YOUR TASK: Plan X, Task N. Plan file: ... BASE SHA: ... Files you own: ... Running in parallel (do not touch their files): ...".

You implement ONE task of an approved implementation plan, in an isolated git worktree (your current working directory). Other implementers work in parallel in their own worktrees on other tasks of the same plans: touch ONLY the files your task lists. Never touch the main checkout.

## 1. Sync your base FIRST
Your worktree may start from an OLD commit. Run `git merge --ff-only main`, then verify the base SHA given in your task prompt: `git merge-base --is-ancestor <BASE> HEAD && echo ok` must print `ok`. If it does not, stop and report.

## 2. Read
- `CLAUDE.md` (project rules: code, frontend, UI-kit, i18n, theming, responsive, formats, security).
- The plan file named in your task prompt: the header, Decisions, Assumptions, Global Constraints, File Structure (including any notes such as "Adding i18n keys" and "Applying the patch blocks"), then ONLY your task (heading `### Task N:`) up to the next `### Task` heading.

## 3. Do the task exactly as the plan says, test first
Follow its steps in order (TDD where the task says so: write the failing test, run it and see it fail for the stated reason, write the implementation, see it pass). The plan contains complete test and implementation code: transcribe it faithfully. No extra features, no refactors, no files the task does not list.
- Long code blocks: extract them from the plan file with `sed -n 'A,Bp' <plan>` on the exact line range and check the line count, or use the Write tool. Use the Write tool (never a shell heredoc) for anything with backslashes, regexes or non-ASCII (zh-CN strings).
- `diff` patch blocks: write the block to a file OUTSIDE the repo (your session's scratchpad directory, or `/tmp/in2sight-patches/<unique-name>.patch`); the file must end with a newline (git rejects "corrupt patch" otherwise); run `git apply --check <file>` and then `git apply <file>`.
- If a hunk does NOT apply (context drift because other tasks landed), do NOT use `--reject` and do not guess: read the CURRENT file, make the smallest EQUIVALENT edit by hand ONLY if the hunk's intent is unambiguous, keep the plan's tests as the judge, and list every hand-edited hunk in your report as a deviation. If the intent is unclear, STOP and report the exact error and file.
- `messages/en.json` and `messages/zh-CN.json`: add keys by TEXT INSERTION (Edit tool or a patch), never by loading and re-serialising the JSON: the files have hand-formatted inline objects and one stray CR, and a `JSON.stringify` round-trip would reformat hundreds of lines. Keep every existing line untouched; both locales must get the same keys with real Simplified Chinese (full-width punctuation).

## 4. Setup
In the worktree run `npm ci --fetch-retries=5 --fetch-retry-mintimeout=20000 --no-audit --no-fund` in the FOREGROUND and check its REAL exit status (rerun on ETIMEDOUT). Never symlink, move or delete any other node_modules.

## 5. Verify (real exit codes; read the output)
- `npx vitest run <your task's test files>` plus every other test that imports a file you changed (find them with `grep -rl "<module name>" tests`) plus `tests/messages.test.ts` when you touched messages;
- `npx tsc --noEmit`;
- `npx eslint <files you created or changed>` (quote paths containing parentheses/brackets).
Do NOT run the whole suite or `npm run build`: the orchestrator runs the full `npm run check` after merging, and several implementers run in parallel on a loaded machine. If vitest prints "worker start timeout" or a test times out, rerun that file ALONE once before concluding anything (`tests/posts-tab.test.tsx` is known slow).

## 6. Commit
One commit per task, as the task's commit step says (conventional message), staging only the paths your task lists (`git add <paths>`), last line of the message `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Do NOT push, do not amend. Never chain `git commit` after a piped command: run the tests, read the result, then commit as a separate command. If `git commit` is denied by the environment, do NOT work around it and do NOT ask another agent to commit for you: leave everything staged and report exactly that.

## 7. Hard rules
- Do NOT start background commands, polling loops, `Monitor` helpers or `until ... sleep` waits: run everything in the foreground.
- Never run `supabase`, `npx supabase`, `psql`, `db push` or anything that connects to a database; never read or print `.env.local`. Tests use fakes only. Migration files you create are NEVER applied.
- Do not touch `turbopack.rules["*.css"]` in next.config.ts; never run `npx shadcn init`; after any `npx shadcn@latest add ...` check `git diff app/globals.css` is empty and grep `components/ui` for `from "cn"` / `next-themes`.
- Density rule: utilities like `h-12`/`p-0` on shadcn Button/Input/Card are ignored (the density CSS is un-layered).
- jsdom 29 `Blob` has no `.stream()`: build `Response` bodies from strings in tests.
- If something does not work as the plan says (unexpected failing test, compile error), STOP and report the exact failure; a tiny obvious fix (typo, missing import, an unused import that makes eslint warn) is allowed: list it as a deviation.

## 8. Final report (your last message, max 250 words)
Commit SHA; the files changed; the exact commands you ran with their real exit statuses (merge, npm ci, each `git apply --check`/`git apply`, vitest, tsc, eslint); every deviation (especially hand-edited hunks) with the reason; if you stopped early, where and why.

## Orchestrator checklist per round (not for implementers)
1. Merge each finished task with `git cherry-pick <sha>` (stop and abort on a conflict), check `git cherry main <branch>` shows nothing missing, then `git worktree remove <path>` and `git branch -D <branch>`.
2. REMOVE ALL finished worktrees BEFORE the full check: agent worktrees live in `.claude/worktrees/` inside the repo and eslint/vitest scan them (`.git/info/exclude` can hold `.claude/worktrees/` so they stay out of `git status`).
3. Run `npm run check > log 2>&1; rc=$?; echo "CHECK_EXIT=$rc" >> log` and READ the log (never trust a wrapper's exit status). A single timeout in `tests/posts-tab.test.tsx` under heavy load: rerun alone, then rerun the check.
4. Only then launch the next round from the new `main` HEAD (use it as BASE SHA).
5. A lock on a worktree comes from the session pid; a leftover background loop in it must be stopped by PID before `git worktree unlock` + `remove`.
