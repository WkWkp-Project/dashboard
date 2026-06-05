# TODO — Wakuwaku Dashboard

Living list of pending work, compiled from session history.
Updated as items land or get added.

---

## 🔴 Critical · Quick Wins (do this week)

### 1. Backup super-admins — single-line failsafe
**Risk if skipped:** If `jarupat@team.wkwkp.com` ever loses access, nobody can promote new admins. System becomes read-only forever.

**Action:**
```javascript
// index.html ~line 1570
const SUPER_ADMINS = [
  'jarupat@team.wkwkp.com',
  '<co-founder>@team.wkwkp.com',     // pick one trusted backup
  '<safe-locked-email>@team.wkwkp.com' // optional 3rd, store credentials in safe
];
```
**Effort:** 5 min · **Severity:** ⭐⭐⭐⭐⭐

---

### 2. Schema version field on campaign JSON
**Risk if skipped:** Adding a new field to the campaign schema breaks old Drive copies on read. `normalizeCampaign` covers most cases but isn't bulletproof.

**Action:**
- Add `schemaVersion: 4` (current) to `campaignDriveJsonPayload`
- `normalizeCampaign` reads version, runs migrators sequentially
- Add `CURRENT_SCHEMA_VERSION` constant and bump on each schema change
- Migrator functions stay in code permanently (never delete)

**Effort:** 2 hr · **Severity:** ⭐⭐⭐⭐

---

### 3. CLAUDE.md (architecture documentation)
**Risk if skipped:** In 6-12 months, nobody (including current maintainers) will remember why decisions were made. Easy to break invariants like "Drive = source of truth".

**Action:** Run the `/init` skill which scans the codebase + drafts CLAUDE.md.
Cover at minimum:
- Architecture (Drive vs Firestore split)
- Critical invariants
- Save / sync flow + retry strategy
- Role matrix (admin/editor/operation/viewer/customer)
- Deploy steps + rollback (incl. `firebase deploy --only firestore:rules`)
- Self-test location + how to run

**Effort:** 2 hr · **Severity:** ⭐⭐⭐⭐

---

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
