# TODO — Wakuwaku Dashboard

Living list of pending work, compiled from session history.
Updated as items land or get added.

---

## 🔴 Critical · Quick Wins (do this week)

### ✅ 1. Backup super-admins — DONE
Landed in commit after `7d7ba6a` — `SUPER_ADMINS` now contains
`jarupat@team.wkwkp.com` + `watson@team.wkwkp.com`. Self-test guards
the list against shrinking back to 1.

To add more failsafes later, append to the `SUPER_ADMINS` array in
`index.html` (around line 1573). Each new entry needs an actual
account that can log in — these are real bootstrap-admin paths, not
just labels.

---

### ✅ 2. Schema version field — DONE
`SCHEMA_VERSION = 4` already existed and was already being written to the
Drive payload. What this task added was the missing migration pipeline:

  * `migrateCampaignSchema(raw)` — version-dispatched scaffold; today's
    body has no migrators (data is at v4 and old reads still pass through
    `normalizeCampaign`'s implicit defaults) but the convention + the
    comment block guide the next contributor where to append.
  * `normalizeCampaign` now calls `migrateCampaignSchema` first so every
    in-memory campaign carries a current `schemaVersion`.

The convention for future schema changes is documented at the constant:
bump `SCHEMA_VERSION`, write `migrateVNToVNplus1` as a pure function,
append `if (v < N+1) c = migrateVNToVNplus1(c)` to the dispatcher.

---

### ✅ 3. CLAUDE.md — DONE
Generated via the `/init` skill, hand-edited to match this codebase.
Covers commands, the six load-bearing architecture invariants, save
flow, role matrix, where things live in `index.html` by line range,
deploy/rollback, the `__diag()` investigation pattern, and the list
of things to actively resist (cross-references BIBLE §11 anti-patterns).

---

### ✅ Customer / editor / operation auto-share gap — DONE (urgent fix)
Bug reported as "Customer ไม่เห็นแคมเปญ แม้ assign · ไม่เห็นแคม แม้แอดเข้ามาใหม่".
Root cause: `saveCampaignJsonToDrive` only auto-shared the Drive folder with
admins; the campaign's `clientEmail` and editor/operation members were
never granted Drive permission, so their search returned an empty list
even though Firestore correctly said they were assigned.

Two fixes landed together:
  * `shareCampaignFolderWithClient(camp)` — new helper called after every
    successful Drive save. Looks up `camp.clientEmail` in the Firestore
    roster, gives them Drive permission matching their role (customer/
    editor/operation → writer, viewer → reader, admin → skip because
    `shareCampaignFolderWithAdmins` covers them).
  * `saveMemberFromModal` — was only sharing on customer/viewer roles;
    now also shares with editor/operation. Same role→perm mapping.

**Backfill for already-broken assignments:** open the Members modal for
each affected member and click Save (no field changes needed) — that
re-runs the share loop. Or have the admin open and save any change on
the campaign itself; saveCampaignJsonToDrive will trigger the new
auto-share path.

### ✅ Audit-round-2 hardening — DONE (6 latent issues, 3 commits)
Picked 6 of the 8 risks surfaced in the late audit. The remaining two
(handoff bundle size limit, presence-throttle on idle) are still in
"พิจารณา" status per the team's call.

Commit `96c7a20` — UX safety (4 micro-fixes):
  * Token refresh on visibility return — wall-clock check on
    `visibilitychange` forces a refresh if the throttled setTimeout
    drifted past expiry, ending the "open a tab for 90 minutes, come
    back, watch the next save 401" pattern.
  * Save indicator click cooldown (4s + isSaving guard) — stops
    indicator-mashing during a failing save from queueing N parallel
    forceSave() calls.
  * localStorage quota toast — second-tier `localStorage.setItem` failure
    now surfaces a one-shot user toast instead of silently dropping the
    backup ("⚠️ Browser storage เต็ม — เซฟ Drive ก่อน refresh").
  * Revert dialog counts files about to be lost — scans the chosen
    snapshot for files with `_wasEmbedded=true && !driveFileId` and
    reports the exact number, replacing the abstract "media won't come
    back" warning. Zero-loss case swaps to a reassuring line.

Commit `0df48c3` — Snapshot bloat mitigation:
  * `stripMediaForSnapshot` now also trims log to `SNAPSHOT_LOG_LIMIT=100`
    so the campaign-wide log doesn't get triple-stored inside snapshots.
  * `__diag().campaignsLoaded` reports per-campaign `payloadKB`,
    `snapshots` count, `logEntries` count — early-warning signal before
    save throughput degrades.

Commit `e33c0ab` — Parallel media offload:
  * `offloadEmbeddedMediaBeforeCloudSave` batched at
    `OFFLOAD_CONCURRENCY=3`. 10-file attach drops from ~20s to ~7s.
  * Stop semantics + uploadStatus mutations preserved exactly.

Still under "พิจารณา":
  * #5 Handoff bundle size pre-check
  * #7 Presence heartbeat under Page Visibility API

## 🟠 Diagnosis pending — waiting on user/external input

### 4. Pat — campaign "123" recovery confirmation
**Status:** Asked user to check Drive trash for `wakuwaku_campaign.json` in Pat's folder. Awaiting confirmation that the file was there and was restored (or wasn't, meaning it was a deeper issue).

### 5. thanita@team.wkwkp.com — "add more แล้วข้อมูลหาย"
**Status:** Added `window.__diag()` diagnostic. Asked thanita to:
1. Open DevTools → Console
2. Run `__diag()` BEFORE adding asset → copy output
3. Add asset + click save → wait 5s
4. Run `__diag()` AGAIN → copy output

**Awaiting:** Both outputs to compare and pinpoint the exact failure mode (token expiry / no driveFolderId / save error swallowed / pre-fix backup missing email field).

### 6. Komsan — confirm save now works
**Status:** Multi-admin concurrent-edit clobber fixed by silent-sync guard (b6723d7). Per-campaign dirty tracking (085b8c6) prevents save-loop overwriting siblings.

**Awaiting:** Confirmation Komsan can edit + save without losing data.

### 7. firestore.rules deployment for `control_signals`
**Status:** User confirmed `แก้มาแล้ว rule` (rules updated). Should already be live.
**Action if any:** Spot-check the Firebase Console → Firestore → Rules tab matches `/home/user/dashboard/firestore.rules`.

---

## 🟡 Should-Fix · Deferred but tracked

### From Codex code review
- [ ] **Codex #3** — `test/run-tests.mjs` hard-codes `/opt/node22/lib/node_modules/playwright/index.js`. Switch to `import { chromium } from 'playwright'` + `npm install --save-dev playwright`. Otherwise the suite is only runnable on the original dev's box.
- [ ] **Codex #4** — Firestore rules for `control_signals` accept any admin write. Add payload validation: `request.resource.data.id == campaignId`, `ts is number`, `deleted is bool`, `keys().hasOnly([...])`, `modifiedBy == request.auth.token.email.lower()`.

### From earlier banner work (pre-Fix C removal)
- [ ] **Banner #4 (defer)** — clock-skew check `sig.ts vs driveDbModifiedTime` not used now (banner removed in 635bef2), but if any future code compares writer-client clocks to Drive modifiedTime, beware: Drive's clock is server-side, client clocks can drift.
- [ ] **Banner #5 (defer)** — Queue / re-show pattern: if any new "incoming update" UI is added later, queue rather than instant re-pop while `pendingChanges` is true.

### From QA review (real but low-impact)
- [ ] **QA #2** — `_dirtyCampaignIds.clear()` in `saveToDrive` non-admin early-return path. Cosmetic; UI gates prevent reaching this path in practice.
- [ ] **QA #5** — `currentUserEmail` could read empty briefly during login if a non-Google provider returned no email. Add a fallback chain at the assignment site.
- [ ] **QA #6** — `saveAssetFromModal`: re-fetch `existing` right before computing `createdAt` so a silent-sync mid-modal doesn't bake a stale timestamp into the edit.
- [ ] **QA #9** — `tryRestoreSession`: add a `settled` flag so the 5s `setTimeout` becomes a no-op once the listener has already fired. Cosmetic; current guard `if (timedOut && !currentUser)` already prevents a spurious warn.
- [ ] **QA #10** — `confirmDeleteCampaign`: between `trashCampaignJsonInDrive` and the local-state mutation, a silent sync could remove the campaign already. Re-check `campaigns.find(...)` before filtering.
- [ ] **QA #12** — `tryRestoreSession` sessionStorage branch doesn't reset `currentUserEmail`. On shared machines this could attribute User B's actions to User A's email in the audit log. Set it from `s.userEmail` or refuse to restore.

---

## 🟢 Medium-term hardening (within 1-2 months)

### 8. Error reporting service — Sentry or Firebase Crashlytics for Web
**Why:** Surface bugs users hit but don't report. Stack traces + frequency over time.
**Effort:** ~4 hr (add SDK, wire up CSP, configure)

### 9. Drive ETag concurrent-edit detection
**Why:** Catch millisecond-race writes that Phase 3 can't see. Use `If-Match: <ETag>` on Drive PATCH; on 412 Precondition Failed → reload + retry.
**Effort:** ~30 lines

### 10. Admin's own Drive backup folder (previously labelled Q2A' / Q2B)
**Why:** Customer revokes their folder share → admin currently has no Drive copy. Periodic write to admin's own `wakuwaku_admin_backup/` keeps a safety copy without breaking the "customer owns data" promise.
**Effort:** ~1 day (folder discovery, naming, retention policy)

### 11. Firestore Emulator in CI
**Why:** A bad rules deploy locks every admin out simultaneously. Validating rules in the emulator before deploy prevents the disaster.
**Effort:** ~1 day (setup + workflow file)

### 12. logAction in `confirmDeleteCampaign`
**Why:** Today, deletions are silent in the audit log — Pat camp 123 disappeared and no one could trace who deleted it. Add a log entry to the campaign right before trashing, and write a top-level deletion log somewhere shared.
**Effort:** ~10 min

---

## 🔵 Long-term scale prep (do before hitting the limit)

### 13. Lazy load campaign content
**Trigger:** Approaching 100 campaigns per admin. Today `loadCampaignJsonFilesFromDrive` reads every file on login → O(N) Drive calls.
**Approach:** Load Firestore index immediately, fetch each campaign's JSON on first navigation to it. Cache for the session.

### 14. Virtualize members drawer
**Trigger:** 100+ members in roster. Sidebar DOM scales linearly today.
**Approach:** Render only visible items + scroll buffer. `react-window`-style without React.

### 15. Firestore Blaze plan
**Trigger:** ~50,000 reads / 20,000 writes a day on the free Spark plan. Today's usage is well under, but with ~20 active admins it'll cross.
**Action:** Add billing to the Firebase project. Pay-as-you-go from $0; budget alerts at ~$10/mo.

### 16. Pagination on every "lists everything" query
- Firestore `control_members` — `.limit(50).startAfter(last)`
- Firestore `control_campaigns` — same pattern
- Drive search — Drive API supports `pageToken`

---

## 📊 Monitoring · Recurring tasks

- **Weekly:** Glance Firebase Console → Usage to spot anomalies
- **Monthly:** Drive API quota dashboard
- **Quarterly:** Firebase SDK version review (currently 10.13.0 compat)
- **Annually:** Major Firebase SDK upgrade — schedule a 1-day window with rollback plan

---

## ✅ Already shipped (recent, for context)

Recent commits on `fix-dash-codex` (PR #9) that addressed earlier asks:

- `cf23d69` — QA fixes: restore marks all campaigns dirty + delete-signal cleans dirty set
- `3d42de5` — `window.__diag()` diagnostic
- `234de4e` — Firebase auth-restore timeout 1.5s → 5s (login forced every visit)
- `b6723d7` — Silent-sync guard inside syncDatabaseFromDrive (concurrent-edit clobber)
- `83e0a84` — Smart 30s → 3 min poll (signal channel is primary)
- `635bef2` — Remove update banner, add centre save-success popup
- `085b8c6` — Per-campaign dirty tracking (Phase 3)
- `3f68035` — localStorage identity guard + Drive/Local source badge
- `4f7caac` — Section A: size hint + delete-thumb button
- `b65de4b` — `maybeOfferLocalRestore` called in `tryRestoreSession` (F5 restore)
- `e81746a` — `maybeOfferLocalRestore` also triggers when localStorage > Drive
- `99d5c8b` — Emergency download + recovery banner
- `d928bbc` — Abort delete on Drive trash failure + skip trashed in index load
- `8e752be` — Signal rule + trash-on-delete + delete signal
- `f6f0b69` — (later reverted by 635bef2) Banner ack memory
- `14fb19f` — Phase 1+2: members drawer, save retry queue, live update banner
- `44b7b57` — Remove breadcrumb from topbar
- `22762f9` / `8bf484c` / `249b67b` / `a16dad1` — Sidebar brand updates
