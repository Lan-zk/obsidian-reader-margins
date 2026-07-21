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
