# Reader Margins AI Engineering Guardrails

> Status: mandatory repository engineering policy for human and AI changes.
> Scope: source code, tests, styles, configuration, build/deployment artifacts, and technical documentation.
> Last evidence refresh: 2026-07-19, Git baseline `9c68334` plus the then-current uncommitted UI hardening changes.

## 1. Why this file exists

This repository has repeatedly produced implementations that looked correct in fixtures or passed the existing tests but violated the real Obsidian/PDF.js contract. The recurring failures were not mainly syntax mistakes. They came from implicit assumptions about host object shapes, coordinate spaces, persistence ordering, DOM realms, lifecycle ownership, and identity.

This file turns those failures into executable working rules. It is intentionally stricter than a style guide.

The rules were derived from:

- the current runtime chain and tests;
- Git history, especially the remediation commits listed in section 12;
- the adversarial review and repair conversations from 2026-07-10, 2026-07-14, and the current UI hardening pass;
- private design/review files under `docs/` when present locally.

`docs/` is intentionally ignored. This file must therefore remain self-contained: an agent may use local design documents as additional evidence, but must not require an ignored file to understand or verify these rules.

## 2. Instruction and evidence hierarchy

When sources disagree, use this order:

1. The user's explicit instruction for the current task.
2. `AGENTS.md` / `CLAUDE.md` and this file.
3. An explicitly named canonical product/design document, if it exists in the working copy.
4. Current source code and tests as evidence of implementation, not automatically as product requirements.
5. README, comments, old plans, and prior conversations as supporting context only.

Never use a green test to overrule a known host contract or explicit product decision. Never silently broaden a task because an old document or abandoned implementation contains adjacent features.

For important review conclusions, distinguish:

- **Source fact**: directly demonstrated by the checked-out code, configuration, Git history, or command output.
- **Inference**: a conclusion drawn from multiple facts but not directly executed.
- **Recommendation**: a proposed change that is not current behavior.
- **Pending verification**: a claim requiring real Obsidian, a real PDF, a popout window, or another unavailable environment.

## 3. Mandatory workflow for every code change

### 3.1 Before editing

An agent MUST:

1. Read this file.
2. Run `git status --short` and identify pre-existing changes.
3. Read the smallest relevant product/design material and the production call chain, not only a test or README.
4. State the exact scope and the behavior that must remain unchanged.
5. Identify which project invariants in section 5 are involved.
6. Select tests from the matrix in section 7.

Pre-existing changes belong to the user. Do not revert, stage, reformat, relocate, or include them in a commit unless the user explicitly authorizes it.

### 3.2 During implementation

For bug fixes and behavior changes, use red-green-refactor:

1. Add the smallest regression test that reproduces the real failure.
2. Run that test and confirm it fails for the expected reason.
3. Implement the minimum correction.
4. Run the targeted test and confirm it passes.
5. Refactor without widening the behavior.
6. Run the relevant suite and then the full verification gate.

A test written after the implementation is useful coverage, but it is not evidence that the test can detect the original regression. If a true red run is impractical, record why.

Do not combine an unrelated refactor, visual redesign, migration, or API cleanup with a bug fix. If multiple changes are necessary, separate them into independently reviewable slices.

### 3.3 Before handing off

Run:

```bash
npm run verify
```

Then inspect:

```bash
git status --short
git diff --stat
git diff --check
git diff --cached --check
```

The final report MUST state:

- the exact commands run and their result;
- the test file/test count reported by the latest run;
- build/typecheck status;
- whether real Obsidian GUI smoke testing was performed;
- remaining uncommitted/untracked files relevant to the task;
- anything explicitly excluded by the user.

Do not say “fixed,” “complete,” “safe,” or “compatible” when only fixtures and a production bundle were checked. Use “automated tests/build pass; real-host behavior remains pending” where applicable.

## 4. Repository architecture agents must understand

The primary runtime path is:

```text
ReaderMarginsPlugin.onload
  -> DurableAnnotationStore.loadAndValidate
  -> PdfViewManager
  -> ViewerSession.attach/reconcilePage/dispose
  -> mark/card/connector renderers
  -> PersistenceCoordinator / MarkdownExportService
```

Relevant responsibility boundaries:

| Area | Current owner | Rule |
|---|---|---|
| Plugin composition | `src/main.ts` | Orchestrates; must not become a second store or session owner. |
| Host/private API adaptation | `src/host/*` | Private Obsidian/PDF.js shape knowledge stays here. |
| Durable state and validation | `src/store/*` | All canonical mutations go through store methods. |
| Viewer lifecycle and projections | `src/session/*` | Owns event subscriptions, drafts, selection, reconciliation, and cleanup. |
| Pure layout/geometry | `src/render/card-drag-geometry.ts`, `src/render/card-layout-engine.ts`, `src/render/page-projection.ts` | Prefer pure functions with explicit coordinate contracts. |
| DOM projection | `src/render/*` | Must be idempotent and owner-document aware. |
| Export | `src/export/*` | User-selected target and ownership checks are authoritative. |
| Unit and host contracts | `src/tests/unit`, `src/tests/host-contract` | Different evidence levels; neither substitutes for real-host smoke tests. |

Do not let host `any` values spread into domain/store code. If a private host shape changes, repair the adapter and its host-contract evidence instead of teaching every consumer the new shape.

## 5. Project invariants

These are non-negotiable unless the user explicitly changes the product design.

### 5.1 Persistence and revisions

- `DurableAnnotationStore` is the canonical in-memory mutation boundary.
- Persist full immutable snapshots. Do not pass live mutable store objects into async saves.
- Revisions must increase monotonically for accepted mutations only.
- A failed older save must never overwrite or replace a newer pending snapshot.
- `flushBestEffort()` is not proof that every possible external write succeeded; failure status must remain observable.
- A validation failure must not increment canonical revisions or enqueue persistence.
- Delete/undo must preserve annotation and document identity through restore semantics, not create a new logical record.

Every persistence change requires an interleaving test, not only a success-path test.

### 5.2 Runtime schema and hostile input

- Treat `loadData()` and imported/exported text as untrusted.
- Validate nested documents, annotations, geometry, colors, timestamps, paths, and settings before indexing or rendering.
- Future/unsupported schema must fail closed and must not be overwritten by defaults.
- A corrupt record may be isolated only if diagnostics make that decision visible; silent partial trust is forbidden.
- Never interpolate unvalidated IDs into selectors. Prefer exact DOM references or escaped selectors.
- Render user text with `textContent`; do not introduce `innerHTML` for annotation content.

### 5.3 Source identity

- A PDF path is not a document identity.
- Bind annotations using `sourceSignature` and compare both primary fingerprint and page count.
- PDF.js 5.x-style identity is `pdfDocument.fingerprints[0]`; do not invent a fixture-only `fingerprint` property.
- `"unknown"` is a degraded state, not proof of equality.
- A same-path replacement must hide stale annotations rather than silently bind them to the new PDF.
- Legacy signature upgrades require a verified fingerprint and matching page count and must never rewrite an already verified identity.

### 5.4 Coordinate systems

Every geometry value must have an explicit space. Do not pass an unlabelled `x`, `y`, `top`, or `rect` across layers.

Current contracts:

| Value | Space | Conversion rule |
|---|---|---|
| Annotation rects | `page-css-v1`, scale 1, page-local, top-left origin | Render by multiplying by current PDF scale. |
| Stored card `y` | `page-css-v1`, page-local | `containerY = pageOffsetY + y * scale`. |
| Stored card `x` | viewer-container content pixels | Clamp again when the window/layout changes. |
| Pointer input | viewport/client pixels | Convert once at the session/geometry boundary. Never persist directly. |
| Card/connector DOM positions | viewer-container content coordinates | Include scroll/page offsets exactly once. |

Required regression dimensions for coordinate changes:

- page 1 and page 2+;
- scale other than 1;
- scrolled container;
- left and right rails;
- narrow margins and dense cards;
- pinned/dragged and automatic cards;
- render after page detach/re-attach.

Never fix a multi-page bug with another offset constant. Name the source and target spaces and test the conversion.

### 5.5 Host API and fixtures

- Obsidian PDF internals are private and version-sensitive. Put capability probes and defensive shape reads in `src/host/*`.
- A fixture is a model of the host, not the source of truth.
- When changing a host shape, first obtain evidence from the installed host, official primary documentation, or a direct runtime probe. Update the fixture only after that evidence exists.
- Capability results must control behavior. Do not compute a degraded/unsupported state and then continue to attach or write anyway.
- Missing required capabilities fail closed. Optional UI capabilities may degrade independently.
- `pagesdestroy` is a session/document-level event; do not treat it as a per-page virtualization notification.

Any host-sensitive change requires both a host-contract test and a recorded real-host verification plan/result.

### 5.6 Window, DOM realm, events, and cleanup

- Never assume global `window`, `document`, `Node`, `HTMLElement`, `SVGElement`, `navigator`, or timers belong to the active PDF.
- Derive constructors, clipboard, animation frames, media queries, and timers from `element.ownerDocument.defaultView`.
- An `instanceof` check must use the target element's realm constructor or a structural check.
- Every `addEventListener`, EventBus subscription, observer, animation frame, and long-lived timer needs an owner and an idempotent disposer.
- Register session lifetime work with `DisposableScope`; one failing disposer must not block the others.
- Re-attaching, changing child/eventBus identity, opening/closing a popout, or disabling the plugin must not leave stale listeners or DOM.
- Async callbacks must check generation/session identity before mutating current state.

### 5.7 Reconciliation and transient UI state

- Store data is durable state; DOM classes and animation intents are projections.
- Reconciliation must be idempotent: repeated events may rebuild, but must not duplicate marks, cards, connectors, or listeners.
- Change events must carry enough information to reconcile after deletion; do not query a record after it has been removed to discover its old page.
- Distinguish `created`, `updated`, `deleted`, and `restored`. Do not infer mutation meaning from “record exists.”
- Page-specific transient state must be keyed by annotation ID and page.
- Consume an enter/stitch intent only after the target DOM was actually created; a missing/detached page must not consume it.
- Every one-shot class must clean up on its completion event and through a timeout/dispose backstop.
- Respect `prefers-reduced-motion`; removing CSS animation alone is insufficient if JS leaves transient classes or hidden states behind.

### 5.8 Selection and drafts

- A cached selection is not valid merely because it is recent.
- Clear or revalidate it on `selectionchange`, page/session generation changes, and immediately after successful creation.
- A click/drag threshold must prevent a selection gesture from triggering mark hit-testing.
- Textarea input must update `DraftController` continuously so a re-render does not restore stale content.
- Revision conflicts must preserve the user's draft and surface the conflict.
- Dispose must explicitly attempt the documented best-effort draft policy; silent draft loss is forbidden.

### 5.9 Identity and settings

- IDs, not display values, define identity.
- Active colors use `colorIdSnapshot`; hex values and names can legitimately be duplicated or changed.
- Legacy value-based fallback is allowed only when it resolves to exactly one current color.
- Settings UI must not mutate canonical store data before validation succeeds.
- Invalid settings remain unpersisted and must not advance revision.

### 5.10 Export and file ownership

- The user's normalized target path is authoritative from modal through service.
- Default export names must avoid accidental collisions.
- Overwrite requires explicit user intent plus a fresh ownership/revision check immediately before writing.
- Foreign or user-edited Markdown must never be silently replaced.
- Export failures must be visible; a toolbar pulse or closed modal is not proof of success.

### 5.11 Accessibility, localization, and motion

- All icon-only controls require localized `aria-label` and title text.
- Stateful controls expose explicit state, e.g. `aria-pressed="true|false"` for every color swatch.
- Keyboard focus must reveal the same annotation/card/connector relationship as pointer hover.
- Focusable controls must remain visible on `:focus-visible` / `:focus-within`; do not hide the only drag affordance from keyboard users.
- Use at least a 24px practical target for compact card controls and do not make adjacent targets overlap.
- User-facing status, placeholder, error, and retry text goes through `src/i18n/index.ts`.
- Truncation is visual only when the full source text remains semantically available.
- Reduced-motion behavior needs a host-contract test and JS cleanup, not only a media-query rule.

## 6. Testing standards

### 6.1 Evidence levels

| Level | Location/method | Proves | Does not prove |
|---|---|---|---|
| Pure unit | `src/tests/unit` | Deterministic domain/store/codec/layout behavior | Obsidian object shape or browser layout |
| Host contract | `src/tests/host-contract` | Adapter expectations, DOM ownership, event and session behavior against controlled shapes | That the controlled shape matches the installed host |
| Production build | `npm run build` | TypeScript compatibility and bundle generation | Runtime attachment, visuals, or persistence in Obsidian |
| Direct runtime probe | DevTools or a minimal script against the installed host | A specific private API/object/event claim | Full user workflow |
| Manual smoke | Real Obsidian + real PDFs | End-to-end behavior in the tested matrix | Other host versions or untested PDFs/windows |

Never collapse these levels into one “tests passed” statement.

### 6.2 Test quality rules

- Test public behavior or an explicit contract, not a copy of the current implementation.
- Name regression tests after the failure condition, not the helper used.
- Include the failure interleaving or lifecycle boundary; a steady-state assertion is insufficient for an async bug.
- Use fake timers only when the code under test uses the same window/realm timers.
- Clean up prototype patches, fake timers, DOM, sessions, and listeners in `finally`/dispose paths.
- Avoid arbitrary sleeps where a deterministic event, fake timer, or flush hook exists. If a real delay is unavoidable, explain the boundary.
- Verify negative behavior: no duplicate DOM, no stale record, no unintended save, no transient class left behind.
- For legacy compatibility, test both the accepted unique fallback and the rejected ambiguous case.
- Do not weaken production guards to make fixtures pass.

### 6.3 Change-to-test matrix

| Changed area | Minimum targeted tests before full gate |
|---|---|
| `persistence-coordinator.ts` | success, coalescing, failure with no newer pending, failure with newer pending, flush while in flight |
| Store/schema/settings | absent, valid, future, deeply malformed, read-only behavior, revision conflict, invalid mutation not persisted |
| Host adapter/capabilities | real-shape fixture, missing capability, changed child/eventBus identity, cross-window realm, explicit direct-probe note |
| Anchor/locator/selection | locator success/fallback/unresolved, repeated quote context, selection cancel/change, duplicate-trigger prevention |
| Page/card geometry | page 2+, non-1 scale, scroll offset, both rails, narrow/dense layout, pinned obstacle, detach/re-attach |
| Reconciliation/events | repeated render, create/update/delete/restore, two sessions for one PDF, stale DOM removal |
| Draft/editing | input before re-render, conflict, save/cancel, dispose, underline auto-edit |
| Export | default unique path, custom target, owner/foreign file, explicit replacement, write error |
| UI/i18n/accessibility | en/zh, runtime language update, keyboard focus parity, explicit ARIA state, duplicate color values, long text |
| Animation/timers | normal completion, missing completion event, reduced motion, dispose mid-flight, target page not mounted |

### 6.4 Manual smoke matrix for release-affecting changes

At minimum record:

- Obsidian version and bundled PDF.js version;
- plugin build/commit or working-tree identity;
- one normal text PDF and one difficult fixture relevant to the change;
- page 1 and later page;
- zoom, scroll, close/reopen, plugin reload;
- two views of the same PDF;
- popout window if DOM/window code changed;
- save failure/retry if persistence changed;
- keyboard-only path and reduced motion if UI changed.

If this matrix was not run, say so. Do not invent a passing smoke record.

## 7. Verification commands

Primary gate:

```bash
npm run verify
```

It runs all Vitest tests, TypeScript/production build, and whitespace/error-marker checks for both unstaged and staged diffs.

Useful targeted commands:

```bash
npm test -- --run src/tests/unit/persistence-coordinator.test.ts
npm test -- --run src/tests/host-contract/obsidian-pdf-host.test.ts
npm test -- --run src/tests/host-contract/viewer-session.test.ts
npm test -- --run src/tests/host-contract/annotation-card-accessibility.test.ts
```

This repository currently has no lint script. Do not claim lint passed. If lint is introduced later, add it to `npm run verify` in the same change.

## 8. Git and workspace hygiene

- Do not commit, stage, push, or create a branch unless the user asks.
- Preserve the dirty worktree. Compare final status with the baseline status.
- Inspect the actual diff; a test count alone does not detect unrelated edits.
- Do not use destructive reset/checkout commands to clean user changes.
- Do not add generated `main.js`, source maps, `test-obsidian/`, console logs, screenshots, `.playwright-mcp/`, or tool scratch files.
- Some old Playwright artifacts are already tracked. Do not use that precedent to add more, and do not delete existing tracked artifacts in an unrelated task.
- `docs/` contains ignored/private working material. Do not change `.gitignore` or force-add anything under `docs/` unless the user explicitly names it for version control.
- Keep `AI_ENGINEERING_GUARDRAILS.md`, `AGENTS.md`, and `CLAUDE.md` tracked and mutually consistent.
- Before a commit, inspect staged paths and staged diff; avoid duplicate commits or accidentally including prior user changes.

## 9. Common low-level mistakes that are forbidden

- Editing only the fixture so it agrees with production code.
- Treating a path, display name, hex value, or DOM position as durable identity.
- Persisting viewport/client coordinates.
- Mixing page-local and container-global coordinates in one layout calculation.
- Reading global DOM constructors/timers for a popout-owned element.
- Registering an event or timer without a disposal path.
- Consuming async/transient state before its target exists.
- Clearing CSS animation only on `animationend` without a backstop.
- Mutating canonical settings before validation.
- Cancelling a draft before knowing a conflicting save succeeded.
- Querying a deleted record to learn where it used to render.
- Using `innerHTML` for annotation/user content.
- Silently overwriting export targets.
- Claiming real-host compatibility from jsdom fixtures.
- Claiming lint passed when no lint command exists.
- Rewriting or staging unrelated dirty files.

## 10. Definition of Done

A change is ready for handoff only when all applicable items are true:

- [ ] Scope and exclusions match the user's instruction.
- [ ] Pre-existing worktree changes were identified and preserved.
- [ ] Relevant call chain and invariants were checked.
- [ ] Bug/behavior changes have a demonstrated regression test where practical.
- [ ] Targeted tests pass.
- [ ] `npm run verify` passes from the final working tree.
- [ ] No new generated/tool artifacts are tracked.
- [ ] UI strings and ARIA state are localized where applicable.
- [ ] Events, timers, observers, animation frames, and transient classes have cleanup.
- [ ] Cross-window and reduced-motion effects were considered where applicable.
- [ ] A real Obsidian smoke result is recorded, or explicitly marked pending.
- [ ] Final report names verification evidence and residual uncertainty.

## 11. Review checklist for AI-authored changes

Before accepting another agent's work, ask:

1. What assumption does the code make about Obsidian/PDF.js, and where is that assumption verified?
2. Which coordinate space does each geometry value use?
3. What happens if the page/view/window is rebuilt between scheduling and execution?
4. What happens if persistence fails while a newer mutation arrives?
5. What durable identity is used, and can its display value be duplicated or changed?
6. Can the operation be repeated without duplicate DOM, records, listeners, or files?
7. What happens on malformed old data, plugin reload, view close, and two simultaneous views?
8. Does keyboard focus expose the same state as pointer hover?
9. Does reduced motion leave a functional static state?
10. Which claims still require real-host verification?

If the author cannot answer these questions with code/tests/command evidence, the review is incomplete.

## 12. Historical evidence behind the rules

| Failure pattern | Evidence | Rule produced |
|---|---|---|
| Failed revision 1 save overwrote newer revision 2 pending data | Adversarial runtime probe; fixed by `c375502` | Persistence tests must cover failure interleavings and preserve the newest full snapshot. |
| Fixture and implementation both used a non-real PDF fingerprint shape | Review finding H-01; fixed by `23318ed` | Host fixture follows verified host evidence, never the reverse. |
| Shallow schema acceptance crashed later during indexing/render | Review finding H-02; fixed by `37f616a` | Deep hostile-input validation before canonical state/indexing. |
| Capability report existed but did not control attach behavior | Review finding H-07; fixed by `c7dfa09` | Capability probes must fail closed and drive behavior. |
| Export modal target was not propagated to the writer | Review H-06/M-07; fixed by `4948786` | User-selected target remains authoritative across the entire call chain. |
| Anchor resolver existed only in tests, while production blindly repainted geometry | Review H-03; fixed by `62b3464` | Tests do not count as implementation; trace the production call chain. |
| Draft existed in a controller but textarea changes did not continuously reach it | Review H-04; fixed by `33dae0e` | Draft state must survive DOM rebuild, conflict, and dispose. |
| Multi-page/dense card layout mixed page-local and container coordinates | Review H-05 and card-dragging task; fixes around `24f1ab6` plus later working-tree changes | Every geometry value declares a coordinate space; page 2+ is mandatory coverage. |
| Global DOM realm assumptions failed for popout windows | Review H-12; fixed by `56bf15c` and later focus/timer hardening | Derive DOM constructors and timers from `ownerDocument.defaultView`. |
| Cached selection created stale/duplicate annotations | Fixed by `1eeee85` and `2eb5017` | Revalidate/clear selection at lifecycle and action boundaries. |
| Delete/update events lacked mutation/page information | Fixed by `ab0a44a`; later expanded to explicit change kinds | Events carry enough old/new identity to reconcile without querying deleted state. |
| Legacy unknown fingerprint data hid old annotations after stricter identity handling | Fixed by `9c68334` | Compatibility repair must be narrow, verified, persisted, and regression tested. |
| UI motion was scheduled before DOM creation, crossed pages, and could leave one-shot classes | Current 2026-07-19 hardening tests | Transient intents are page-scoped, consumed only after render, reduced-motion safe, and have cleanup backstops. |
| Duplicate color values selected multiple swatches | Current 2026-07-19 accessibility tests | Identity uses color ID; value fallback must be uniquely resolvable. |

The history shows a consistent pattern: most serious defects crossed a boundary—async save ordering, host/fixture, page/container, session/window, durable/transient, ID/display value, or modal/service. Future reviews should start at those boundaries rather than at individual syntax details.
