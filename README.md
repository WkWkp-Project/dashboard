# Wakuwaku Studio — Production Dashboard

Content production dashboard. **JSON data → Firestore** (wkwkp holds master for handoff). **Asset files (รูป/วิดีโอ) → Google Drive**. Per-campaign member access for clients.

---

## 🔥 Firebase one-time setup

The Firebase config is already wired in `index.html`. You only need to enable the services in Firebase Console:

### 1. Enable Google Sign-In

Firebase Console → **Authentication → Sign-in method → Google → Enable**.
Under **Authorized domains**, add the domain you host from (e.g. `wkwkp-project.github.io` and `localhost` for testing).

> **Important — use the same OAuth client for Drive token reuse (optional):**
> Authentication → Sign-in method → Google → **Web SDK configuration** → set Web client ID to `165279376241-gbee5rudn234trve8fsm6ccl35kgrrei.apps.googleusercontent.com`. This lets the existing Drive OAuth consent carry over. If you skip this, login still works but Drive uploads may require re-consent the first time.

### 2. Enable Firestore

Firebase Console → **Firestore Database → Create database** → Production mode → location `asia-southeast1`.

### 3. Publish security rules

Firebase Console → **Firestore Database → Rules** → paste the contents of [`firestore.rules`](./firestore.rules) → **Publish**.

The rules enforce:
- `@team.wkwkp.com` emails = **admin** (read/write everything).
- Other emails = read-only access to campaigns they are listed in (`members[]`).
- Edit the `team.wkwkp.com` domain in `firestore.rules` if your team uses a different one.

### 4. Add members to a campaign

Open the campaign → **Edit Info** → **Members** field → one email per line → Save.
The campaign auto-syncs to Firestore. That email can now sign in and will see only this campaign.

**Live demo:** _Add your GitHub Pages URL here after deployment_

---

## 🚀 Deploy on GitHub Pages (5 minutes)

### Step 1 — Create a new GitHub repo

```bash
# In the folder containing index.html
git init
git add index.html README.md
git commit -m "Initial deploy: Wakuwaku Studio v3"
git branch -M main
```

Then create a new repo on [github.com/new](https://github.com/new) (name it whatever you like, e.g. `wakuwaku-studio`).

```bash
git remote add origin https://github.com/YOUR_USERNAME/wakuwaku-studio.git
git push -u origin main
```

### Step 2 — Enable GitHub Pages

1. Go to your repo on GitHub
2. **Settings** → **Pages** (left sidebar)
3. Under "Build and deployment":
   - Source: **Deploy from a branch**
   - Branch: **main** / **/ (root)**
4. Click **Save**

After 1–2 minutes, your site will be live at:
```
https://YOUR_USERNAME.github.io/wakuwaku-studio/
```

### Step 3 — Update Google OAuth (CRITICAL)

Google won't let your app login until you whitelist the GitHub Pages URL.

1. Go to [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
2. Click your OAuth 2.0 Client ID (the one ending in `gbee5...rrei`)
3. **Authorized JavaScript origins** → add:
   ```
   https://YOUR_USERNAME.github.io
   ```
   ⚠️ No trailing slash, no path — just the origin.
4. Click **Save** (changes take ~5 min to propagate)

### Step 4 — Test

Open `https://YOUR_USERNAME.github.io/wakuwaku-studio/` and click **Continue with Google Workspace**. Should login normally now.

---

## 🔒 Make repo private (optional but recommended)

If your CLIENT_ID is hardcoded in the file, anyone can see it. While CLIENT_ID isn't a secret (it's meant to be public), a private repo prevents random crawlers from hitting it.

**Option A — Private repo + GitHub Pages:** Requires a paid plan (Pro/Team). Not free.

**Option B — Public repo, restrict OAuth (free, recommended):** 
- Keep the repo public
- In Google Cloud Console, OAuth Consent Screen, set **User Type: Internal** (only allows users in your Google Workspace organization)
- Or restrict by domain: only `@team.wkwkp.com` emails can login

---

## 🔄 Updating later

Just edit `index.html`, then:

```bash
git add index.html
git commit -m "Update: <what changed>"
git push
```

GitHub Pages auto-deploys within ~1 minute.

---

## 🛠 Local development

To test changes before pushing:

```bash
# Python (built-in)
python3 -m http.server 8080

# Or Node
npx serve -p 8080
```

Then add `http://localhost:8080` to Authorized JavaScript origins for local OAuth testing.

---

## 📁 What's in the bundle

When you click **Prepare Handoff** → **Finalize**, users get a ZIP with:

```
{ClientName}_Handoff/
├── campaign-data.json   ← all assets, prompts, metadata
├── activity-log.json    ← full audit trail
├── final-report.pdf     ← formatted PDF report
├── README.html          ← client-facing instructions (Thai)
└── images/              ← reserved for future image storage
```

The bundle is **fully self-contained** — clients can re-import it anytime by dragging into the auth screen.

---

## ⚙️ Configuration

Key constants in `index.html` (around line 686):

```js
const CLIENT_ID = '165279376241-gbee5rudn234trve8fsm6ccl35kgrrei.apps.googleusercontent.com';
const SAVE_DEBOUNCE_MS = 2500;  // batch saves to avoid Drive API spam
const DB_FILENAME = 'wakuwaku_database.json';
```

---

## 🐛 Troubleshooting

| Problem | Fix |
|---|---|
| `redirect_uri_mismatch` | Add the exact URL (origin only, no path) to OAuth Authorized origins |
| `idpiframe_initialization_failed` | OAuth Consent Screen not configured. Go to Cloud Console → OAuth consent screen → fill app info |
| Login button does nothing | Check browser console. Usually means Google Identity Services hasn't loaded — refresh page |
| Save indicator stays "Saving..." | Drive API might not be enabled. Cloud Console → APIs & Services → Library → search "Google Drive API" → Enable |
| Bundle download fails | Browser blocked download. Allow downloads from your domain |

---

## License

© Wakuwaku Production Studio · Internal use only
