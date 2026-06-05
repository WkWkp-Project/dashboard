# 📖 Wakuwaku Dashboard — The Bible

Comprehensive playbook covering architecture, operational procedures, every
pending task in detail, and the reasoning behind every decision. Intended as
the single reference a future maintainer can read end-to-end to understand
the system.

Companion to `TODO.md` (which is the short, scannable checklist version).

> **Last update:** Session that introduced TODO.md + this bible.
> Keep this file under version control; every architectural decision should
> be recorded here for the next person.

---

## Table of Contents

1. [Architecture — immutable principles](#1-architecture--immutable-principles)
2. [Data flow reference](#2-data-flow-reference)
3. [Role & permission matrix](#3-role--permission-matrix)
4. [Operational runbooks](#4-operational-runbooks)
5. [Tier 1 — Critical Quick Wins](#5-tier-1--critical-quick-wins)
6. [Tier 2 — Diagnosis Pending](#6-tier-2--diagnosis-pending)
7. [Tier 3 — Should-Fix Deferred](#7-tier-3--should-fix-deferred)
8. [Tier 4 — Medium-term Hardening](#8-tier-4--medium-term-hardening)
9. [Tier 5 — Long-term Scale Prep](#9-tier-5--long-term-scale-prep)
10. [Tier 6 — Monitoring (recurring)](#10-tier-6--monitoring-recurring)
11. [Anti-patterns — what NOT to do](#11-anti-patterns--what-not-to-do)
12. [Decision trees](#12-decision-trees)
13. [Glossary](#13-glossary)

---

## 1. Architecture — immutable principles

These are the load-bearing decisions. Every change to the codebase must respect them. Breaking any of these requires a deliberate architecture review.

### 1.1 Drive is the single source of truth for customer data
- `wakuwaku_campaign.json` per campaign, stored in **customer's own Drive folder**
- Media files in `wakuwaku-media-{campaign-id}/` subfolder of the same folder
- Customer can revoke admin's access at any time → ownership stays with customer
- Disaster recovery starting from "everything Firestore is gone" is possible because Drive still has every byte

**Implication:** Never put canonical campaign data anywhere except Drive. Firestore can hold metadata, signals, or roster, never asset content.

### 1.2 Firestore is the control plane only
- `/control_members/{email}` — admin/role roster
- `/control_campaigns/{id}` — discovery index (no content)
- `/control_signals/{id}` — save/delete notifications (no content, ~100 bytes)
- `/control_presence/{key}` — online team list

**Implication:** If a feature needs to write more than a few kilobytes of structured data, it goes to Drive, not Firestore.

### 1.3 localStorage is a resilience layer, not storage
- `wkw_local_backup_v1` key — full DB snapshot written on every keystroke
- Stripped of media base64 if too big for browser quota
- Carries `email` field to prevent cross-user leakage on shared browsers
- Cleared on user-confirmed restore; never persisted to Drive

**Implication:** Treat localStorage as "the safety net before Drive ACKs the save". It must never be presented as a primary store.

### 1.4 Per-campaign dirty tracking
- `_dirtyCampaignIds: Set<string>` tracks which campaigns the local user mutated
- `saveToDrive` uploads only dirty campaigns (Phase 3)
- Two admins editing different campaigns no longer overwrite each other

**Implication:** Every new mutation entry point must mark dirty correctly. Default `scheduleSave()` marks `currentCampaignId`; pass `id` or `'all'` when that default is wrong.

### 1.5 Silent-sync guard
- `syncDatabaseFromDrive({silent:true})` returns immediately when `_hasLocalEditInFlight()` is true
- Loud (non-silent) syncs are user-initiated and explicitly accept the clobber

**Implication:** Any new Firestore listener that triggers a sync inherits the guard automatically. Don't add per-listener guards; trust the central one.

### 1.6 No backend server
- Static HTML + Firebase BaaS (auth + Firestore) + Google Drive (storage)
- No Node.js to patch, no database to migrate, no API gateway to scale
- Hosting = anywhere that serves a single HTML file

**Implication:** Resist any proposal to add a server. The serverless property is the system's biggest stability advantage. See § 11 anti-patterns.

---

## 2. Data flow reference

### 2.1 Write path (admin edits a field)

```
keystroke
  ↓
mutation function (e.g. saveAssetFromModal, saveCampaignInfo, edit Section B)
  ↓
logAction('CREATE'/'UPDATE', desc)         ← writes to campaign.log
  ↓
scheduleSave([campaignId])                 ← default = currentCampaignId
  ├─ pendingChanges = true
  ├─ markCampaignDirty(id)                 ← adds to _dirtyCampaignIds
  ├─ persistLocalBackup()                  ← writes localStorage with email
  ├─ cancelSaveRetry()                     ← fresh edit invalidates old retry plan
  └─ setTimeout(saveToDrive, 2500ms)       ← debounce
  ↓ (2.5s)
saveToDrive()
  ├─ isSaving guard
  ├─ isAdmin guard (early return for members)
  ├─ offloadEmbeddedMediaBeforeCloudSave   ← uploads base64 to Drive subfolder first
  ├─ targets = campaigns.filter(hasFolder)
  ├─ dirty = targets.filter(in _dirtyCampaignIds)  ← Phase 3
  ├─ for each dirty: saveCampaignJsonToDrive(c)
  │   ├─ findCampaignJsonFile(c)           ← reuse driveDbFileId if still valid
  │   ├─ uploadJsonToDriveFile(...)        ← multipart PATCH
  │   ├─ shareCampaignFolderWithAdmins     ← best effort
  │   ├─ registerCampaignInIndex           ← Firestore control_campaigns
  │   └─ pingCampaignChanged               ← Firestore control_signals
  │   └─ _dirtyCampaignIds.delete(c.id)
  ├─ pendingChanges = false
  ├─ setDataSource('drive')                 ← badge → green
  ├─ dismissSaveFailureBanner()
  ├─ showSaveSuccessPopup()                 ← centre popup
  └─ persistLocalBackup()                   ← localStorage now matches Drive
```

### 2.2 Read path (admin loads or syncs)

```
syncDatabaseFromDrive({silent?})
  ↓
[silent path]: if (_hasLocalEditInFlight()) return  ← critical guard
  ↓
waitForFreshToken (silent GIS refresh if accessToken missing)
  ↓
loadCampaignJsonFilesFromDrive               ← Drive search + N file fetches
  ├─ trashed=false filter in search
  └─ for each: GET ?alt=media
  ↓
loadCampaignsFromIndex                       ← augment with Firestore index entries
  ├─ for each entry: GET ?fields=id,trashed  ← metadata check FIRST
  ├─ skip if meta.trashed
  └─ then GET ?alt=media for content
  ↓
filterVisibleCampaigns                       ← role-based visibility
  ↓
campaigns = visible.map(normalizeCampaign)
  ↓
keepLocal currentCampaignId if still in list
  ↓
setDataSource('drive')
  ↓
renderEverything()
```

### 2.3 Real-time path (teammate's edit reaches us)

```
teammate saves campaign X
  ↓ (their saveToDrive succeeds)
they call pingCampaignChanged(X.id, ...)
  ↓ (write to /control_signals/X)
our subscribeSignals onSnapshot fires
  ↓
onCampaignSignal(sig)
  ├─ _lastSignalRecvTs = Date.now()         ← heartbeat for smart-poll
  ├─ skip if own echo (modifiedBy === currentUserEmail)
  ├─ skip if Control.isOwnSignal (tab-local ts cache)
  ├─ if sig.deleted:
  │   ├─ filter campaigns
  │   ├─ _dirtyCampaignIds.delete(sig.id)   ← QA fix #11
  │   └─ toast '🗑️ X ลบ Y'
  └─ (update branch is silent now — banner removed in Fix C)
```

### 2.4 Fallback / safety paths

```
3-minute poll (REMOTE_POLL_MS) → pollRemoteChanges
  ├─ skip if signal channel is fresh (< REMOTE_POLL_MS)
  ├─ skip if local edit in flight
  └─ GET Drive metadata; if modifiedTime changed → silent sync

2-minute auto-resync (AUTO_RESYNC_INTERVAL_MS) → maybeResync
  ├─ skip if isSaving | saveTimer | pendingChanges | document.hidden
  └─ silent sync

Save retry queue (on saveToDrive failure)
  ├─ delays [5s, 15s, 45s, 2m, 5m]
  ├─ pendingChanges stays true through retries
  └─ after exhaustion: downloadManualBackup + showSaveFailureBanner

F5 / page refresh
  ├─ tryRestoreSession waits up to 5s for Firebase auth
  ├─ if currentUser → load from Drive
  └─ if Firebase missed: sessionStorage fallback (operator/client only)

Save fail recovery banner buttons
  ├─ ↩ กู้คืนล่าสุด → restoreFromLocalBackup
  ├─ 🛟 Download → downloadManualBackup
  └─ ↻ ลองใหม่ → cancelSaveRetry + saveToDrive
```

---

## 3. Role & permission matrix

Source of truth: `js/control.js` PERMISSIONS object.

| Capability | admin | editor | operation | viewer | customer |
|---|---|---|---|---|---|
| manageMembers | ✅ | ❌ | ❌ | ❌ | ❌ |
| manageAdmins | ✅ | ❌ | ❌ | ❌ | ❌ |
| seeAllCampaigns | ✅ | ❌ | ❌ | ❌ | ❌ |
| assignCampaign | ✅ | ❌ | ❌ | ❌ | ❌ |
| createCampaign | ✅ | ❌ | ❌ | ❌ | ❌ |
| deleteCampaign | ✅ | ❌ | ❌ | ❌ | ❌ |
| editSectionA | ✅ | ✅ | ❌ | ❌ | ❌ |
| editSectionB | ✅ | ✅ | ✅ | ❌ | ✅ |

Legacy UI gates (translation layer in `applyControlRole`):
- `admin`, `editor` → `userRole='internal'` (`isAdmin` is true only for `admin`)
- `operation`, `customer` → `userRole='operator'`
- `viewer` or null → `userRole='client'`

Bootstrap rule: any email under `ADMIN_EMAIL_DOMAIN` ('team.wkwkp.com') or in `SUPER_ADMINS` can self-provision their own admin doc on first login. See § 5.1 for why super-admins must be more than one email.

---

## 4. Operational runbooks

### 4.1 Deploying a change

1. Work on a feature branch off `fix-dash-codex` (current PR #9 base).
2. Run `node test/run-tests.mjs` locally — must show passing count not lower than the previous run.
3. Commit with a descriptive message (the bodies of recent commits are a good style template).
4. Push: `git push origin <branch>`.
5. PR review: at minimum re-read your own diff in the GitHub UI.
6. Merge to whatever the team treats as deploy branch.
7. **If `firestore.rules` changed**: `firebase deploy --only firestore:rules`.
8. **If JSON schema changed**: bump `CURRENT_SCHEMA_VERSION` (after Tier 1 #2 lands) and add a migrator.

### 4.2 Rolling back a bad deploy

| What broke | Rollback |
|---|---|
| HTML / JS | `git revert <sha> && git push` — static site updates on next load |
| `firestore.rules` | `firebase rollback firestore:rules` OR re-deploy the previous rules from git |
| Both | Revert the commit, then `firebase deploy --only firestore:rules` |

### 4.3 Adding a new admin

For team members on `@team.wkwkp.com`:
1. They click "Login with Google" → bootstrap-domain rule self-provisions their admin doc → done. No action needed.

For non-domain admins (rare):
1. Existing admin opens "Members" panel → "+ Add" → enter email + role → save.
2. Firestore rules require existing admin to do the write.

### 4.4 Removing an admin (revoking access)

1. Existing admin → Members panel → click member → "Remove".
2. This calls `Control.removeMember(email)` which deletes the Firestore doc.
3. Their next page load: `resolveRole` returns null → app falls into `userRole='client'` → read-only UI.
4. To fully kick them out of in-flight sessions, ask them to logout (no force-logout mechanism today).

### 4.5 Disaster recovery — Firestore project lost / corrupted

1. Drive data is intact (canonical) — don't panic.
2. Recreate the Firebase project + redeploy `firestore.rules`.
3. Bootstrap admin logs in → auto-provisions their admin doc.
4. Bootstrap admin clicks "Add member" for each teammate, re-assigns campaigns.
5. On first sync, `loadCampaignJsonFilesFromDrive` discovers all `wakuwaku_campaign.json` files the admin can access → campaigns reappear automatically.
6. (Firestore campaign-index will rebuild as each campaign is next saved.)

### 4.6 Disaster recovery — admin lost Drive access mid-session

Admin's actions during the session were captured by `persistLocalBackup` on every keystroke.

1. Admin sees the recovery banner ⚠ (after 2 save failures).
2. Click "↩ กู้คืนล่าสุด" — restores from localStorage into memory.
3. Admin emails a colleague to re-share the customer Drive folder.
4. Once shared, admin clicks "↻ ลองใหม่" — `saveToDrive` runs against the now-accessible Drive.

If localStorage was also cleared (incognito, manual cache flush):
1. Admin clicks "🛟 Download" — JSON file lands in Downloads.
2. After re-getting Drive access, manually re-import via Quick Handoff Viewer (or future Import button — Tier 3 / Tier 4).

### 4.7 Investigating "save แล้วหาย" reports

The shortcut: ask the affected user to run `window.__diag()` in DevTools console and send the returned object.

Look at:
- `you.isAdmin` — false ⇒ role issue, see § 3
- `you.hasAccessToken` — false ⇒ token expired, ask them to logout/login
- `currentCampaign.driveFolderId` — empty ⇒ `saveToDrive` throws, ask them to set Drive folder URL
- `save.lastSaveError` — exact reason
- `save._consecutiveSaveFailures` — > 0 means saves are failing but user dismissed the indicator
- `localBackup.email` — `(missing — ...)` ⇒ backup from older build will be skipped by restore dialog; their next save will fix it
- `localBackup.emailMatchesYou` — false ⇒ they're on someone else's browser, identity guard correctly skipping their backup

---

## 5. Tier 1 — Critical Quick Wins

The three highest-leverage changes. Together: ~½ day of work, locks in 5+ years of stability.

### 5.1 Backup super-admins ✅ DONE

**Status:** Landed. `SUPER_ADMINS` now contains two entries:

```javascript
const SUPER_ADMINS = [
  'jarupat@team.wkwkp.com',
  'watson@team.wkwkp.com'
];
```

A self-test (`SUPER_ADMINS has ≥ 2 entries (single point of failure guard)`)
fails if a future refactor shrinks the list back to one entry.

**To extend later**

Append to the array in `index.html` (~line 1573). Each entry must be a real
account that can log in — bootstrap-admin promotion happens on the first
login of that account, so a label without a working sign-in won't help in a
real incident.

**Verify**

After the next deploy, sign in with `watson@team.wkwkp.com` in an incognito
window. The app should load with full admin capabilities and the member list
should be visible.

---

### 5.2 Schema version field ✅ DONE

**Status:** Landed. `SCHEMA_VERSION = 4` (was already present) is now paired
with a real migration pipeline:

  * `migrateCampaignSchema(raw)` lives just below `SCHEMA_VERSION` and
    dispatches version-by-version. Today the body is empty (the data is at
    v4 and there's nothing older that we need an explicit migrator for —
    `normalizeCampaign`'s implicit defaults already cover ancient shapes).
    The scaffold + the comment make it obvious where to append the next
    migrator.
  * `normalizeCampaign` calls `migrateCampaignSchema` first, so every
    in-memory campaign carries the current `schemaVersion` regardless of
    what was on Drive.

**Convention going forward** (the actual policy this task locks in):

1. Bump `SCHEMA_VERSION`.
2. Write `migrateV{N}To{N+1}(c)` as a pure function (input → output, no I/O).
3. Append `if (v < N+1) c = migrateV{N}To{N+1}(c)` to the dispatcher.
4. NEVER delete an old migrator — customer Drives may still hold v(N-3) JSON.

**Fix**

In `campaignDriveJsonPayload`:
```javascript
const CURRENT_SCHEMA_VERSION = 4;  // bump when adding fields

function campaignDriveJsonPayload(camp) {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    campaign: camp,
    savedAt: new Date().toISOString()
  };
}
```

In `normalizeCampaign`:
```javascript
function normalizeCampaign(raw) {
  raw = raw || {};
  const v = raw.schemaVersion || 1;
  let c = raw;
  if (v < 2) c = migrateV1ToV2(c);
  if (v < 3) c = migrateV2ToV3(c);
  // ... one if-clause per version forever
  c.schemaVersion = CURRENT_SCHEMA_VERSION;
  // existing normalization continues:
  c.assets = (c.assets || []).map(normalizeAsset);
  // ...
  return c;
}

// Migrators stay in code permanently — they're invoked lazily as old data
// is read. Never delete them; the field they migrate from might still
// exist in some customer's Drive folder five years from now.
function migrateV3ToV4(c) {
  // example: a new field that defaults to []
  c.newField = c.newField || [];
  return c;
}
```

**Decision rule:** every PR that touches the campaign JSON shape MUST bump `CURRENT_SCHEMA_VERSION` and add a migrator.

**Test plan**

1. Create a campaign on the current build.
2. Bump version + add a migrator.
3. Reload the campaign — confirm the new field appears in memory after `normalizeCampaign`.
4. Save → reload again — confirm version stamp persists.

**Effort:** 2 hr (one-time scaffolding + first migrator) · **Severity:** ⭐⭐⭐⭐ · **Risk:** low

---

### 5.3 CLAUDE.md ✅ DONE

**Status:** Landed in repo root.

Generated via the `/init` skill and hand-edited so it actually matches
this codebase (Playwright path quirk, the no-package.json reality, where
each subsystem lives by line range, the `__diag()` triage pattern,
cross-references back to this Bible).

The split between the three docs is now:

  * `CLAUDE.md` — day-to-day quick reference. Commands, invariants in
    one sentence each, save flow as a diagram, line-range map.
  * `BIBLE.md` (this file) — narrative depth. Every architectural
    decision, every task tier, every runbook, anti-patterns, decision
    trees, glossary.
  * `TODO.md` — scannable checklist with completion marks.

When updating one, check whether the others need a parallel touch.

---

## 6. Tier 2 — Diagnosis Pending

Items waiting on external input from real users / production data. No code changes until information arrives.

### 6.1 Pat — campaign "123" recovery confirmation

**State:** A campaign disappeared. Hypothesis: someone deleted it (`confirmDeleteCampaign` doesn't log deletions yet — see Tier 4 § 8.5). Drive file should be in trash.

**Awaiting:** Owner of the campaign's customer folder checks their Drive Trash for `wakuwaku_campaign.json` modified around the time of the disappearance.

**Then:**
- If found → restore from trash, confirm zombie-prevention fix (`d928bbc`) holds.
- If not found → much rarer issue, escalate.

### 6.2 thanita@team.wkwkp.com — "add more แล้วข้อมูลหาย"

**State:** Reports that after adding multiple assets, content disappears on refresh. Role confirmed admin.

**Awaiting:** Run `window.__diag()` in DevTools console (a) before adding, (b) after adding + 5s wait. Send both outputs.

**Likely causes (in order of probability):**
1. `currentCampaign.driveFolderId === ''` → `saveToDrive` throws "ต้องกรอก Client Drive Folder URL" → she dismisses → never persists.
2. `_consecutiveSaveFailures > 0` → Drive token expired silently → save retry queue burning down → emergency download triggered but she didn't notice.
3. `localBackup.email` missing → backup written by older build → restore dialog refuses to offer it after F5 → looks like data vanished but it's in localStorage, just not surfaced.
4. Network issue between her and Drive (very rare).

### 6.3 Komsan — confirm concurrent save works after recent fixes

**State:** Earlier reports of "ทับงานเพื่อน" should be resolved by `085b8c6` (per-campaign dirty save) + `b6723d7` (silent-sync guard).

**Awaiting:** Sanity test — Komsan and Pat edit different campaigns at the same time, both save, both confirm no data loss.

### 6.4 firestore.rules — `control_signals` deployment spot-check

**State:** User said "แก้มาแล้ว rule". Should already be live.

**Verify:** Firebase Console → Firestore → Rules tab. Compare with `/home/user/dashboard/firestore.rules`. The `match /control_signals/{campaignId}` block must be present.

---

## 7. Tier 3 — Should-Fix Deferred

Real but lower-priority issues that survive on the backlog. None blocks daily usage.

### 7.1 Codex review #3 — test runner hard-coded path

**File:** `test/run-tests.mjs` line 3.
**Today:** `import pkg from '/opt/node22/lib/node_modules/playwright/index.js';`
**Problem:** Only runs on the original dev's machine. Other developers can't run the suite. CI is therefore impossible.
**Fix:** `npm install --save-dev playwright`, then `import { chromium } from 'playwright';`. Update `package.json` (or create one if missing).

### 7.2 Codex review #4 — Firestore rules payload validation for signals

**File:** `firestore.rules` `match /control_signals/{campaignId}`.
**Today:** Any admin can write any shape.
**Risk:** A buggy client could write malformed signal that crashes other clients' listeners; a compromised admin could spoof signals.
**Fix:** Add `request.resource.data.id == campaignId`, `ts is number`, `deleted is bool`, `keys().hasOnly(['id','ts','iso','modifiedBy','displayName','deleted'])`, `modifiedBy == request.auth.token.email.lower()`.
**Caveat:** Test in emulator first; bad rules silently disable the entire signal channel (Tier 4 § 8.4).

### 7.3 Banner edge case #4 — clock skew in old comparison

**Context:** Pre-Fix-C code compared writer's `Date.now()` to Drive's modifiedTime. The banner has since been removed (`635bef2`), but if you reintroduce any "writer-ts vs drive-ts" comparison, beware: clocks can drift.

**Fix sketch:** Either use Drive ETag (Tier 4 § 8.2) or only compare ts deltas relative to each side's own clock.

### 7.4 Banner edge case #5 — queue while pendingChanges

**Context:** If a future "incoming update" UI is added back, design it to queue signals while `pendingChanges` is true, then flush after the user's own save succeeds — not re-pop in a loop.

### 7.5 QA #2 — non-admin dirty cleanup

**Today:** A non-admin reaching `saveToDrive` (shouldn't happen because of UI gates, but defensive) early-returns without clearing `_dirtyCampaignIds`. If the user is later promoted to admin in the same session (also rare), the stale set could cause unexpected uploads.
**Fix:** `_dirtyCampaignIds.clear()` in the early-return path.
**Effort:** 1 line.

### 7.6 QA #5 — currentUserEmail timing

**Today:** During login, `currentUserEmail` is set from `fbAuth.currentUser.email`. If that's empty (rare provider, edge case), it stays empty briefly while the profile fetch runs.
**Fix:** Chain a fallback at the assignment site so it's always non-empty by the time async listeners read it.

### 7.7 QA #6 — saveAssetFromModal stale createdAt

**Today:** `existing` is captured at the top of `saveAssetFromModal`. If a silent sync mid-modal replaces `campaigns[]`, the captured `existing` is stale → the edit may write an older `createdAt` than reality.
**Fix:** Re-find `existing` right before computing the new asset data.

### 7.8 QA #9 — auth timeout settled flag

**Today:** The 5s `setTimeout` in `tryRestoreSession` fires even after the listener already resolved. Harmless (guarded by `if (timedOut && !currentUser)`) but wasteful.
**Fix:** Add `let settled = false`; listener sets it true; `setTimeout` no-ops if settled.

### 7.9 QA #10 — confirmDeleteCampaign async race

**Today:** Between `await trashCampaignJsonInDrive` and the local mutation, a silent sync (allowed because pendingChanges hadn't been set yet) could already have removed the campaign.
**Fix:** Re-check `campaigns.find(...)` right before filtering; bail if already gone.

### 7.10 QA #12 — sessionStorage email leak

**Today:** The sessionStorage restore branch (operator/client only) doesn't refresh `currentUserEmail`. On shared computers, the audit log could attribute User B's actions to User A's email.
**Fix:** Either read `userEmail` from the session blob (if you start writing it there) or force a fresh login for the sessionStorage path.

---

## 8. Tier 4 — Medium-term Hardening

Each item buys a meaningful reduction in a specific failure mode. Pick when the team has a day to invest.

### 8.1 Error reporting service

**Why:** Today, bugs surface when a user complains. Most never complain. Adding Sentry (or Firebase Crashlytics for Web) gives you:
- A stack trace at the exact crash, with surrounding console context
- Frequency over time (the 1 user reporting may be 10 affected)
- Release-tagging so you see which deploy introduced a regression

**How:**
1. Sign up for Sentry free tier (5K errors/mo).
2. Add the JS snippet to `index.html` `<head>`.
3. Wrap top-level uncaught handlers (already exists via Sentry's auto-init).
4. Add `Sentry.captureException(e)` in major `catch` blocks (saveToDrive, syncDatabaseFromDrive).
5. Add `Sentry.setUser({ email: currentUserEmail })` after login.

**Effort:** 4 hr. **Severity:** ⭐⭐⭐⭐.

### 8.2 Drive ETag concurrent-edit detection

**Why:** Phase 3 + silent-sync guard catch most concurrent edits, but two admins saving the same campaign within the same millisecond will still race (last-write-wins). Drive's ETag headers let us detect this.

**How:**
- Cache `etag` from every Drive read.
- On PATCH, send `If-Match: <cached-etag>`.
- On 412 Precondition Failed → reload the file → merge or warn the user → retry.

**Effort:** ~30 lines + careful test path. **Severity:** ⭐⭐⭐.

### 8.3 Admin's own Drive backup folder (Q2B from earlier discussion)

**Why:** "Customer revokes share → admin loses access" has no recovery today beyond manual JSON downloads. Periodic write to an admin-controlled folder gives a passive safety copy.

**How:**
- Per-admin Drive folder, e.g. `WakuwakuAdminBackup/`.
- After each successful `saveToDrive`, also write a copy of the campaign JSON there.
- Retention: keep last 10 per campaign, prune older.
- File naming: `<campaign-id>__<ISO-date>.json`.

**Caveat:** Don't centralise into a team-shared backup folder (the user explicitly rejected that). Each admin has their own.

**Effort:** 1-2 days. **Severity:** ⭐⭐⭐.

### 8.4 Firestore Emulator in CI

**Why:** A bad `firestore.rules` deploy locks every admin out of Firestore simultaneously. The signal channel + member roster + campaign index all stop. Recovery requires re-deploying the previous rules, which means someone needs to be available with deploy keys at the moment of the breakage.

**How:**
1. `npm install --save-dev firebase-tools` (or pin in `package.json`).
2. Add a GitHub Action / pre-commit hook that runs `firebase emulators:exec --only firestore "node test/rules-test.mjs"`.
3. Write `test/rules-test.mjs` covering:
   - bootstrap admin can self-provision
   - non-admin can read but not write `control_members`
   - admin can write to `control_signals`
   - non-authenticated requests are denied

**Effort:** 1 day. **Severity:** ⭐⭐.

### 8.5 logAction in `confirmDeleteCampaign`

**Why:** Pat's camp "123" disappeared and nobody could trace who deleted it because deletion bypasses the per-campaign audit log. (Logging only happens for things you keep, by definition.)

**How:** Before the `showConfirm` callback runs the actual deletion, log to a top-level place:
- Optionally also log to a shared Firestore doc `/control_deletion_log/{auto-id}` with `{ campaignId, campaignName, deletedBy, ts }`.
- Add a "Recent deletions" panel in Data Hub so admins can see who deleted what.

**Effort:** 30 min. **Severity:** ⭐⭐⭐ (visibility) ⭐⭐⭐⭐ (forensics).

---

## 9. Tier 5 — Long-term Scale Prep

These don't matter at today's team size (5-10 admin, 20-50 campaigns). Schedule when monitoring (Tier 6) shows approach of the trigger.

### 9.1 Lazy-load campaign content

**Trigger:** Admin's accessible-campaign count crosses ~100. Today every campaign is fetched on login → linear Drive API cost + slow initial sync.

**Approach:**
- Load Firestore `control_campaigns` index (cheap) immediately to populate sidebar.
- Fetch a campaign's actual JSON content only when the user navigates to it.
- Cache loaded campaigns for the session.
- Pre-fetch the most recently used campaign on idle.

**Effort:** 3-5 days. **Severity:** ⭐⭐⭐⭐ (UX) at the trigger point.

### 9.2 Virtualise members drawer

**Trigger:** 100+ entries in the sidebar.

**Approach:** Render only items in viewport + a buffer. Window-based virtualisation. No React needed; ~150 lines of vanilla.

**Effort:** 2 days. **Severity:** ⭐⭐⭐.

### 9.3 Firestore Blaze plan

**Trigger:** Free Spark plan limits (50K reads / 20K writes per day) come into view. Today's usage is well below.

**Approach:** Upgrade in Firebase Console. Set a Cloud Billing budget alert at $10 to catch runaway costs.

**Effort:** 15 min. **Severity:** ⭐⭐⭐⭐⭐ (if you hit the limit, everything stops).

### 9.4 Pagination everywhere

**Trigger:** Any "list everything" call exceeds 100 items.

**Targets:**
- `Control.listMembers` — Firestore `.limit(50).startAfter(last)`.
- `Control.listCampaigns` — same.
- Drive search — Drive supports `pageToken`.

**Effort:** 1 day per surface. **Severity:** ⭐⭐⭐.

---

## 10. Tier 6 — Monitoring (recurring)

Less about new code, more about not letting the boring become the dangerous.

| Cadence | Task | Where |
|---|---|---|
| Weekly | Glance Firebase Console → Usage dashboard | bit.ly/firebase-console |
| Monthly | Check Drive API quota dashboard in Google Cloud Console | bit.ly/gcp-quotas |
| Quarterly | Review Firebase SDK version (currently 10.13.0 compat). Note breaking-change blog posts | firebase.google.com/support/release-notes |
| Annually | Plan a Firebase SDK major upgrade. Schedule 1-day window with rollback plan. | — |

What to look for in weekly Firestore review:
- Reads approaching 50K/day → upgrade to Blaze (§ 9.3) coming due
- Writes ramping → may be a runaway listener loop (rare)
- Any spike correlating with a deploy → investigate that deploy

---

## 11. Anti-patterns — what NOT to do

Each row is a real proposal that has come up or will come up. Resist for the listed reason.

| Proposal | Why to refuse |
|---|---|
| Add a Node.js / Python backend | Destroys the serverless property. Now you have runtime to patch, scale, monitor. The current "static HTML + Firebase + Drive" stack has no operational overhead. |
| Migrate to React / Vue / Svelte | Frameworks have shorter lifespans than the system you're trying to keep stable. Plain HTML works in 5 years; React 17 → 18 → 19 doesn't. |
| Replace Firestore with PostgreSQL / Supabase | Now you have a second source of truth for control data. Sync between two structured stores will introduce bugs you can't reason about. |
| Store campaign content in Firestore | Breaks invariant § 1.1 — customer no longer owns the data. Also blows past the 1 MiB doc limit. |
| Add npm dependencies for utilities | Each dep is a supply-chain attack surface and a future deprecation. The current zero-dependency design is intentional. |
| Add tracking / analytics | PDPA exposure, performance cost, complexity. Use Sentry for errors only (it doesn't track user behaviour). |
| Hardcode magic strings ("admin", "internal" repeated) | Pull them into constants once. `grep`ability matters when refactoring. |
| Delete migrators after the schema is "done" | Customer Drive folders are not in your control. A migrator deleted today is a bug 18 months from now when a customer opens an old campaign. |
| Force-logout users on rule changes | Breaks trust. Let next-page-load resolve naturally. |
| Add a feature flag system | Solves a problem the team doesn't have at this size. Adds permanent code paths that rarely flip and rot. |

---

## 12. Decision trees

### 12.1 "I want to add a new field to a campaign"

```
Is Tier 1 § 5.2 (schema version) implemented?
 ├─ NO → STOP. Do § 5.2 first.
 └─ YES → Continue.
       ↓
Bump CURRENT_SCHEMA_VERSION.
Write migratorVNToVN+1(c) that adds the field with a sensible default.
Update campaignDriveJsonPayload / normalizeCampaign as needed.
Add a self-test: load a synthetic VN campaign and assert the new field is present after normalisation.
```

### 12.2 "I want to add a new Firestore listener"

```
Will it call syncDatabaseFromDrive at any point?
 ├─ YES → Confirm the silent-sync guard inside syncDatabaseFromDrive (§ 1.5)
 │        catches your case. If you call it silent, you're protected.
 └─ NO → no special action needed.
       ↓
Will it mutate campaigns[] directly?
 ├─ YES → STOP. Reroute through syncDatabaseFromDrive or implement a
 │         per-event handler like onCampaignSignal that respects the guard.
 └─ NO → safe to add.
       ↓
Add a self-test for the listener's normalize step.
Add an unsubscribe call in performLogout (find the existing patterns).
```

### 12.3 "A user reports save แล้วหาย"

```
Ask them to run window.__diag() in DevTools console.
       ↓
you.isAdmin === false?
 └─ Check Firestore /control_members/{their-email} role. Promote if intended.
       ↓
currentCampaign.driveFolderId === ''?
 └─ Tell them to open Edit Info and set the Client Drive Folder URL.
       ↓
save._consecutiveSaveFailures > 0?
 ├─ save.lastSaveError mentions 'token' → tell them to logout/login.
 ├─ save.lastSaveError mentions 'permission' → check Drive folder sharing.
 ├─ save.lastSaveError mentions 'quota' → check Google account storage.
 └─ Other → investigate the specific error.
       ↓
localBackup.email === '(missing — ...)' ?
 └─ Their pre-fix backup is dormant. Have them save anything once
    (any keystroke triggers persistLocalBackup with the new schema),
    then the restore dialog will work next time.
       ↓
None of the above → escalate. Use diag output to file a Sentry issue
once § 8.1 is in place.
```

### 12.4 "Should I refactor / split index.html?"

```
Is the file still under ~10,000 lines?
 ├─ YES → No. The single-file structure is a feature, not a bug.
 └─ NO → Consider it, but split by feature (asset editor, hub, etc.)
         not by technology layer (controllers, views). And add a
         build step only if absolutely required — every build step
         is operational complexity.
```

---

## 13. Glossary

| Term | Meaning |
|---|---|
| Admin | Wkwk team member with full edit rights. Firestore role = `admin`. |
| Bootstrap admin | First-time admin self-provision via email-domain match. Used to break the chicken-and-egg "need an admin to create an admin" problem on fresh deploys. |
| Campaign | Unit of work for a customer. Stored as `wakuwaku_campaign.json` in the customer's Drive folder. |
| Client / Customer | The end user the campaign is for. Role = `customer` or `viewer`; usually accesses via Quick Handoff Viewer (offline bundle). |
| Control plane | Firestore collections (`control_members`, `control_campaigns`, `control_signals`, `control_presence`) that don't hold campaign content, only metadata + notifications. |
| Data plane | Google Drive (campaign JSON + media). The canonical, customer-owned store. |
| Dirty set | `_dirtyCampaignIds: Set<string>` — campaigns the local user has mutated and not yet uploaded. |
| Drive | Google Drive. |
| Editor | Wkwk team member with edit rights but no admin powers. Firestore role = `editor`. |
| Internal | Legacy `userRole` value mapped from `admin` or `editor`. |
| Operation | Operator role limited to Section B. Firestore role = `operation`. |
| Operator | Legacy `userRole` value mapped from `operation` or `customer`. |
| Phase 1 / 2 / 3 | Stability work waves. Phase 3 = per-campaign dirty save. |
| Quick Handoff Viewer | Offline-friendly client UI that opens a ZIP bundle. Used by customers who don't have admin login. |
| Signal channel | `/control_signals/{campaignId}` Firestore docs that announce save/delete events. Real-time replacement for the old 30-45s poll. |
| Source of truth | The canonical store. For campaign content this is Drive; for roster it's Firestore. |
| Super admin | Hardcoded email in `SUPER_ADMINS` that can bootstrap-provision admin docs even before the team has any admins. Failsafe — see § 5.1. |
| Viewer | Read-only role. Firestore role = `viewer`. |
| `__diag()` | Side-effect-free console function that dumps role + save + backup state. First step in every "save แล้วหาย" investigation. |
| `_hasLocalEditInFlight()` | Helper that returns true if `pendingChanges`, `saveTimer`, or `isSaving`. Used by the silent-sync guard. |

---

*End of Bible. Keep adding. Update the Table of Contents when you add a major section.*
