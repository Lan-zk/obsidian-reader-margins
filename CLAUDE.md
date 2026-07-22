# Repository Agent Instructions

Before analyzing, editing, reviewing, testing, or committing this repository, read and follow [AI_ENGINEERING_GUARDRAILS.md](AI_ENGINEERING_GUARDRAILS.md).

The guardrails are mandatory for all repository work. In particular:

- inspect and preserve the dirty worktree before editing;
- treat fixtures as controlled evidence, not proof of the real Obsidian/PDF.js host;
- use regression-first testing for bug fixes and behavior changes;
- run `npm run verify` before reporting completion;
- explicitly separate automated verification from real Obsidian GUI verification;
- do not commit, stage, push, or include ignored `docs/` material unless the user explicitly asks.

Direct user instructions for the current task take precedence. Never use that precedence to fabricate verification evidence or silently modify unrelated user work.

## Windows iteration notes

This repository is developed on Windows (PowerShell primary; Bash tool also available). The codebase itself is cross-platform clean - no hardcoded OS paths, no shell calls - so the only platform-specific risks are operational.

### Line endings (primary risk)

- Committed files use **LF**; `core.autocrlf` converts to CRLF on checkout. There is no `.gitattributes`.
- `npm run verify` runs `git diff --check`, which fails on **mixed line endings** within a file or trailing whitespace.
- Save edited files as **LF** (editor status bar). If `git diff --check` fails on a file you touched, re-save that one file as LF - do not change global `git config`.
- If `git status` shows many modified files after a one-file edit, suspect line-ending churn; investigate before `git add` (never `git add -A` blindly).

### Path separators

- Obsidian vault paths use **`/`**, never `\`. `collectStoredPathMoves` (`src/main.ts`) matches the `${oldFolderPath}/` prefix, so Windows-style backslash paths in tests or fixtures will not match rename logic.
- TypeScript `src/...` imports are path-mapped and OS-independent; use them as-is.

### Shell and filenames

- `npm run verify`, `npm test`, and `git` run identically under PowerShell and Bash. Guardrail example commands (`git diff --check`, etc.) behave the same.
- For POSIX shell snippets, use the Bash tool. PowerShell `&&` requires PS7+; use `;` or separate calls otherwise.
- Windows/macOS filesystems are case-insensitive; Linux/CI is case-sensitive. Never rename a file by case alone (e.g. `Foo.ts` -> `foo.ts`).

### Real-host visual verification (Windows-specific)

- `isDesktopOnly: true`; GUI smoke tests must run on **Windows Obsidian**, not just macOS. Do not assume macOS visual verification transfers.
- Fonts: Hanken Grotesk may fall back to `var(--font-text)` on Windows; verify typography on the target OS.
- CJK synthesized italics render broken on Windows - the codebase de-italicized quotes for this reason; do not reintroduce `font-style: italic` on mixed CJK/Latin text.
- High-DPI scaling affects mark/card geometry; verify at 100% and a scaled DPI.
- jsdom tests do not run CSS animations, real `ResizeObserver` delivery, or real PDF.js virtualization - any visual or layout change needs real-host confirmation per guardrails §6.4.
