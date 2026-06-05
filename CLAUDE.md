# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A single-page content-production dashboard for Wakuwaku Studio. **No build step.** The entire app is `index.html` (~8500 lines) plus `js/control.js` (the Firestore control plane). Hosted statically — anything that serves a single HTML file works.

The longer narrative-style documentation lives in `BIBLE.md` (architecture, runbooks, every pending task in detail). The scannable task checklist is `TODO.md`. Read those when you need depth; this file is the day-to-day quick reference.

## Common commands

```bash
# Run the full self-test suite (Playwright headless). Must pass before push.
node test/run-tests.mjs

# Verbose run — also dumps browser console for debugging individual failures.
VERBOSE=1 node test/run-tests.mjs

# Quick parse-only sanity check (no Playwright needed)
node -e "
const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const re=/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g;
let m, acc=''; while((m=re.exec(html))){ acc += m[1]; }
try { new Function(acc); console.log('parse OK'); } catch(e){ console.log('ERROR:',e.message); }
"

# Local dev server (any will do)
python3 -m http.server 8080
# then open http://localhost:8080 — add it to OAuth Authorized origins first

# Run tests in the browser instead of headless
open http://localhost:8080?test=1
# then in DevTools: window.__testResults
```

There is no lint command, no package.json (the Playwright import path in `test/run-tests.mjs` is currently hardcoded to `/opt/node22/lib/node_modules/playwright/index.js`; see TODO.md Tier 3 #3.1).

There is no "run a single test" command. The self-test framework (`window.__runTests` at the bottom of `index.html`) pushes async tests into `Promise.all` and runs them in parallel — this causes ~9 known intermittent race-failures that aren't production bugs. When investigating a specific test, copy its body into the browser console and run it manually.

## Architecture — the load-bearing invariants

Breaking any of these requires a deliberate architecture review. See `BIBLE.md` §1 for full rationale.

1. **Google Drive is the single source of truth for customer data.** Per-campaign `wakuwaku_campaign.json` files live in the customer's own Drive folder, alongside a `wakuwaku-media-{campaignId}/` subfolder for assets. The customer can revoke admin access at any time — ownership stays with them. Never write canonical campaign content anywhere else.

2. **Firestore is the control plane only.** Four collections: `control_members` (roster + roles), `control_campaigns` (discovery index, no content), `control_signals` (~100-byte save/delete notifications), `control_presence` (online team list). If a feature needs more than a few kilobytes of structured data, it goes to Drive.

3. **localStorage is a resilience layer.** `wkw_local_backup_v1` is written on every keystroke (stripped of media base64 if it exceeds the browser quota). Carries an `email` field so a shared browser can't leak one user's backup to another. Never present as primary storage.

4. **Per-campaign dirty tracking.** `_dirtyCampaignIds: Set<string>` tracks what the local user mutated. `saveToDrive` only uploads dirty campaigns. Default `scheduleSave()` (no arg) marks `currentCampaignId`; pass an id or `'all'` when that default is wrong.

5. **Silent-sync guard.** `syncDatabaseFromDrive({silent:true})` returns immediately when `_hasLocalEditInFlight()` is true (any of `pendingChanges`, `saveTimer`, `isSaving`). Any new Firestore listener that triggers a sync inherits this protection automatically — don't add per-listener guards.

6. **No backend server.** Static HTML + Firebase BaaS + Google Drive. The serverless property is the system's biggest stability advantage; resist proposals to add a runtime to maintain (see BIBLE.md §11 anti-patterns).

## Save flow at a glance

```
keystroke
  → mutation fn (saveAssetFromModal, etc.)
  → logAction()  → writes to campaign.log
  → scheduleSave([campaignId])
    ├─ pendingChanges = true
    ├─ markCampaignDirty(id)            ← Phase 3 dirty set
    ├─ persistLocalBackup()             ← localStorage with email guard
    ├─ cancelSaveRetry()
    └─ setTimeout(saveToDrive, 2500ms)  ← SAVE_DEBOUNCE_MS
  → saveToDrive()
    ├─ isAdmin guard (early return for members)
    ├─ offloadEmbeddedMediaBeforeCloudSave   ← uploads base64 to Drive subfolder first
    ├─ dirty = campaigns.filter(c => _dirtyCampaignIds.has(c.id))
    ├─ for each dirty: saveCampaignJsonToDrive(c)
    │   └─ pingCampaignChanged    ← writes /control_signals/{id}
    └─ setDataSource('drive') + showSaveSuccessPopup()
```

On failure: `scheduleSaveRetry` runs `[5s, 15s, 45s, 2m, 5m]` backoff. After exhaustion, `downloadManualBackup()` auto-fires once and the red recovery banner appears with three buttons (restore from local / download backup / retry now).

## Role & permission matrix

Source of truth: `js/control.js` `PERMISSIONS` object.

| Capability | admin | editor | operation | viewer | customer |
|---|---|---|---|---|---|
| manageMembers/Admins | ✅ | ❌ | ❌ | ❌ | ❌ |
| seeAllCampaigns | ✅ | ❌ | ❌ | ❌ | ❌ |
| create/deleteCampaign | ✅ | ❌ | ❌ | ❌ | ❌ |
| editSectionA | ✅ | ✅ | ❌ | ❌ | ❌ |
| editSectionB | ✅ | ✅ | ✅ | ❌ | ✅ |

Legacy `userRole` mapping (`applyControlRole`): `admin`/`editor` → `'internal'`, `operation`/`customer` → `'operator'`, `viewer`/null → `'client'`. `isAdmin` is true only for control role `admin`.

Bootstrap: any email under `ADMIN_EMAIL_DOMAIN` (`team.wkwkp.com`) or in the `SUPER_ADMINS` array can self-provision their own admin doc on first login. `SUPER_ADMINS` must contain ≥ 2 entries — a self-test guards this.

## Where things live in index.html

The single file is large but the order is consistent. Approximate line ranges:

- ~1500-1700: Module-level state, constants (`SCHEMA_VERSION`, `SUPER_ADMINS`, `REMOTE_POLL_MS`), `migrateCampaignSchema`, UI helpers (banners, popups)
- ~1700-1800: `onCampaignSignal` (signal channel handler) + presence helpers
- ~1900-2100: Authentication — `handleRealGoogleLogin`, `applyControlRole`, `resolveUserRoleFromControl`, `loadCampaignsFromIndex`, `onLoginSuccess`
- ~2200-2400: Session restore — `persistLocalBackup`, `setDataSource`, `tryRestoreSession`, `maybeOfferLocalRestore`
- ~2500-3100: Save flow — `scheduleSave`, `saveToDrive`, `scheduleSaveRetry`, `downloadManualBackup`
- ~3500-3700: Drive helpers — `findCampaignJsonFile`, `saveCampaignJsonToDrive`, `loadCampaignJsonFilesFromDrive`, `syncDatabaseFromDrive`, `_hasLocalEditInFlight`
- ~3800-4000: Background sync — `pollRemoteChanges`, `maybeResync`, `startAutoResync`, presence heartbeat
- ~4100-4400: Render helpers, `normalizeCampaign`, `normalizeAsset`, `renderEverything`
- ~5200-5400: Campaign lifecycle — `saveNewCampaign`, `confirmDeleteCampaign`, `trashCampaignJsonInDrive`
- ~5600-5800: Asset modal — `openAddAssetModal`, `saveAssetFromModal`
- ~6900-7100: Section A — `renderInputPreview`, `uploadInputThumb`, `removeInputThumb`
- ~7300-7400: `window.__diag()` — diagnostic dump for incident triage
- ~7400-end: `window.__runTests` self-test suite

The HTML body itself starts around line 700-1200 (auth overlay, sidebar, topbar, view containers).

## Deploy + rollback

- **Static HTML deploy:** push to `main` (or whatever branch GitHub Pages serves). No build, no CI.
- **Firestore rules:** `firebase deploy --only firestore:rules` after any change to `firestore.rules`.
- **Rollback:** revert the offending commit and push — static site updates on next page load. For rules, `firebase rollback firestore:rules` OR re-deploy the previous file from git.
- **Schema changes:** bump `SCHEMA_VERSION` and append a migrator to `migrateCampaignSchema`. Never delete an old migrator; customer Drive folders may still hold pre-bump JSON shapes for years.

## Investigating "save แล้วหาย" reports

The first move is always: have the affected user run `window.__diag()` in their DevTools console and send back the returned object. It dumps role, `isAdmin`, current campaign state, dirty set, last save error + cause, localBackup metadata (including the email-match check), and the full campaign list with Drive folder/file ids. Decision tree for interpreting it is in `BIBLE.md` §12.3.

## Things to actively resist

(Full list with reasons in `BIBLE.md` §11.)

- Adding a Node/Python backend, a SQL database, or another framework — destroys the serverless property that keeps this system stable.
- Adding npm dependencies for utilities — every dep is a supply-chain surface.
- Force-logging users out on rule changes — breaks trust; let next page-load resolve naturally.
- Hardcoding role strings ("admin", "internal") in new code without going through `controlCan` / the `PERMISSIONS` table.
- Deleting old schema migrators "because nothing uses them" — customer Drive copies may.

## Companion docs in this repo

- `BIBLE.md` — full playbook (architecture, runbooks, every tier of pending tasks, anti-patterns, decision trees, glossary). Read once on onboarding, reference on every architectural decision.
- `TODO.md` — scannable checklist of pending work, ordered by tier. Update when items land.
- `README.md` — user-facing setup (Firebase, OAuth, GitHub Pages deploy).
- `firestore.rules` — control-plane access rules. The source of truth for who can write `control_members`, `control_campaigns`, `control_signals`, `control_presence`.
