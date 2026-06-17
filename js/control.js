/* ============================================================================
 * control.js — Wakuwaku Dashboard "control plane"
 * ----------------------------------------------------------------------------
 * Central, shared source of truth for MEMBERS, ROLES and CAMPAIGN ASSIGNMENTS,
 * stored in Firestore so every admin sees the same data in real time. This is
 * the fix for the long-standing bug where one admin couldn't see members /
 * campaigns that another admin had added (the old roster lived in scattered
 * Drive marker files that weren't shared with every admin).
 *
 * Scope split:
 *   - Control plane (this file): small, flat, structured data → Firestore.
 *       /control_members/{email}  → { email, name, role, campaignFolderIds[], ... }
 *   - Data plane (index.html, unchanged): campaign JSON + media → Google Drive
 *       folder of each client.
 *
 * No build step: this attaches a single global `window.Control`. index.html
 * calls Control.init(firestore) once after Firebase initialises.
 * ==========================================================================*/
(function () {
  'use strict';

  var COLLECTION = 'control_members';
  var COLLECTION_CAMPAIGNS = 'control_campaigns';
  var COLLECTION_PRESENCE = 'control_presence';
  // Lightweight signal channel — small docs (~100 bytes) that announce
  // "this campaign was changed on Drive at ts by modifiedBy". Data itself
  // stays on Drive; this is *only* a notification so other admins don't
  // have to wait for the 45s poll. Keeps Drive as the single source of
  // truth for customer data.
  var COLLECTION_SIGNALS = 'control_signals';

  // --- Role / permission matrix --------------------------------------------
  // Keep this declarative so UI gates read from one place.
  var ROLES = ['admin', 'editor', 'operation', 'viewer', 'customer'];

  var PERMISSIONS = {
    admin:     { manageMembers: true,  manageAdmins: true,  seeAllCampaigns: true,  assignCampaign: true,  createCampaign: true,  deleteCampaign: true,  editSectionA: true,  editSectionB: true },
    editor:    { manageMembers: false, manageAdmins: false, seeAllCampaigns: false, assignCampaign: false, createCampaign: false, deleteCampaign: false, editSectionA: true,  editSectionB: true },
    operation: { manageMembers: false, manageAdmins: false, seeAllCampaigns: false, assignCampaign: false, createCampaign: false, deleteCampaign: false, editSectionA: false, editSectionB: true },
    viewer:    { manageMembers: false, manageAdmins: false, seeAllCampaigns: false, assignCampaign: false, createCampaign: false, deleteCampaign: false, editSectionA: false, editSectionB: false },
    // Customer = pure read-only by design. They can expand details and browse
    // assigned campaigns but cannot mutate. The UX rule is: if you click a
    // button as customer, nothing should happen except a 'read-only' hint —
    // and we'd rather show no button at all than a button that silently fails.
    // To grant edit power, an admin promotes them to operation or higher.
    customer:  { manageMembers: false, manageAdmins: false, seeAllCampaigns: false, assignCampaign: false, createCampaign: false, deleteCampaign: false, editSectionA: false, editSectionB: false }
  };

  function normEmail(e) { return String(e || '').trim().toLowerCase(); }

  function normalizeMember(email, data) {
    data = data || {};
    var role = ROLES.indexOf(data.role) >= 0 ? data.role : 'viewer';
    return {
      email: normEmail(data.email || email),
      name: data.name || '',
      role: role,
      campaignFolderIds: Array.isArray(data.campaignFolderIds) ? data.campaignFolderIds.slice() : [],
      driveFolderUrl: data.driveFolderUrl || '',
      driveFolderId: data.driveFolderId || '',
      createdBy: data.createdBy || '',
      createdAt: data.createdAt || '',
      updatedAt: data.updatedAt || ''
    };
  }

  var Control = {
    _db: null,
    _ready: false,
    _members: [],          // cached, kept fresh by the real-time listener
    _unsub: null,
    _onChange: null,
    ROLES: ROLES,
    COLLECTION: COLLECTION,

    // Bootstrap config — set from index.html so this file stays config-free.
    bootstrap: {
      adminDomain: '',     // e.g. 'team.wkwkp.com' → any email on this domain is admin
      superAdmins: []      // hardcoded fallback admins (lockout protection)
    },

    isReady: function () { return this._ready; },

    init: function (firestore, opts) {
      this._db = firestore || null;
      opts = opts || {};
      if (opts.adminDomain) this.bootstrap.adminDomain = String(opts.adminDomain).toLowerCase();
      if (Array.isArray(opts.superAdmins)) this.bootstrap.superAdmins = opts.superAdmins.map(normEmail);
      return this;
    },

    available: function () { return !!this._db; },

    // --- Permission helpers --------------------------------------------------
    permissionsFor: function (role) {
      return PERMISSIONS[role] || PERMISSIONS.viewer;
    },
    can: function (role, action) {
      var p = this.permissionsFor(role);
      return !!p[action];
    },

    // Is this email a bootstrap admin (domain match or hardcoded super-admin)?
    isBootstrapAdmin: function (email) {
      email = normEmail(email);
      if (!email) return false;
      if (this.bootstrap.superAdmins.indexOf(email) >= 0) return true;
      var dom = this.bootstrap.adminDomain;
      return !!dom && email.length > ('@' + dom).length && email.lastIndexOf('@' + dom) === email.length - ('@' + dom).length;
    },

    // --- Cached reads (synchronous, from the live listener) ------------------
    cachedMembers: function () { return this._members.slice(); },
    cachedMember: function (email) {
      email = normEmail(email);
      for (var i = 0; i < this._members.length; i++) {
        if (this._members[i].email === email) return this._members[i];
      }
      return null;
    },

    // --- Live subscription ---------------------------------------------------
    // onChange(members[]) fires on every Firestore update so all admins stay
    // in sync. Returns an unsubscribe function.
    subscribe: function (onChange) {
      var self = this;
      this._onChange = typeof onChange === 'function' ? onChange : null;
      if (!this._db) {
        // No Firestore — fail soft so the rest of the app still loads.
        self._ready = true;
        if (self._onChange) self._onChange(self.cachedMembers());
        return function () {};
      }
      if (this._unsub) { try { this._unsub(); } catch (e) {} this._unsub = null; }
      this._unsub = this._db.collection(COLLECTION).onSnapshot(function (snap) {
        var list = [];
        snap.forEach(function (doc) { list.push(normalizeMember(doc.id, doc.data())); });
        list.sort(function (a, b) { return (a.name || a.email).localeCompare(b.name || b.email); });
        self._members = list;
        self._ready = true;
        if (self._onChange) self._onChange(self.cachedMembers());
      }, function (err) {
        console.error('[Control] snapshot listener error:', err);
        self._ready = true; // don't wedge the app
        if (self._onChange) self._onChange(self.cachedMembers());
      });
      return this._unsub;
    },

    // One-shot load (used before the listener is up, or as a fallback).
    listMembers: function () {
      var self = this;
      if (!this._db) return Promise.resolve(this.cachedMembers());
      return this._db.collection(COLLECTION).get().then(function (snap) {
        var list = [];
        snap.forEach(function (doc) { list.push(normalizeMember(doc.id, doc.data())); });
        list.sort(function (a, b) { return (a.name || a.email).localeCompare(b.name || b.email); });
        self._members = list;
        self._ready = true;
        return self.cachedMembers();
      });
    },

    getMember: function (email) {
      var self = this;
      email = normEmail(email);
      if (!email) return Promise.resolve(null);
      var cached = this.cachedMember(email);
      if (cached) return Promise.resolve(cached);
      if (!this._db) return Promise.resolve(null);
      return this._db.collection(COLLECTION).doc(email).get().then(function (doc) {
        return doc.exists ? normalizeMember(doc.id, doc.data()) : null;
      });
    },

    // --- Role resolution (with bootstrap) ------------------------------------
    // Resolves the effective role for a freshly-logged-in email. If the email
    // has no control doc yet but is a bootstrap admin, it self-provisions an
    // admin doc (so the very first admin can get in and add everyone else).
    resolveRole: function (email, displayName) {
      var self = this;
      email = normEmail(email);
      if (!email) return Promise.resolve({ email: '', role: 'viewer', member: null, provisioned: false });
      return this.getMember(email).then(function (m) {
        if (m) return { email: email, role: m.role, member: m, provisioned: false };
        if (self.isBootstrapAdmin(email)) {
          // First-run / lockout-safe: create the admin doc.
          return self.upsertMember({ email: email, name: displayName || '', role: 'admin', createdBy: email })
            .then(function (created) {
              return { email: email, role: 'admin', member: created, provisioned: true };
            })
            .catch(function (e) {
              console.warn('[Control] bootstrap admin provisioning failed (continuing as admin in-memory):', e);
              return { email: email, role: 'admin', member: normalizeMember(email, { email: email, role: 'admin', name: displayName || '' }), provisioned: false };
            });
        }
        // Not provisioned and not a bootstrap admin → no access.
        return { email: email, role: null, member: null, provisioned: false };
      });
    },

    // --- Writes (admin-only enforced by Firestore rules + UI gates) ----------
    upsertMember: function (member) {
      var self = this;
      var email = normEmail(member && member.email);
      if (!email) return Promise.reject(new Error('upsertMember: email required'));
      if (!this._db) return Promise.reject(new Error('Firestore not available'));
      var existing = this.cachedMember(email);
      var role = ROLES.indexOf(member.role) >= 0 ? member.role : (existing ? existing.role : 'viewer');
      var doc = {
        email: email,
        name: member.name != null ? member.name : (existing ? existing.name : ''),
        role: role,
        campaignFolderIds: Array.isArray(member.campaignFolderIds)
          ? member.campaignFolderIds.filter(Boolean)
          : (existing ? existing.campaignFolderIds : []),
        driveFolderUrl: member.driveFolderUrl != null ? member.driveFolderUrl : (existing ? existing.driveFolderUrl : ''),
        driveFolderId: member.driveFolderId != null ? member.driveFolderId : (existing ? existing.driveFolderId : ''),
        createdBy: existing ? (existing.createdBy || member.createdBy || '') : (member.createdBy || ''),
        createdAt: existing && existing.createdAt ? existing.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      return this._db.collection(COLLECTION).doc(email).set(doc, { merge: true }).then(function () {
        return normalizeMember(email, doc);
      });
    },

    setRole: function (email, role) {
      if (ROLES.indexOf(role) < 0) return Promise.reject(new Error('Invalid role: ' + role));
      return this.upsertMember({ email: email, role: role });
    },

    // Replace the full set of campaigns a member can see.
    setAssignedCampaigns: function (email, folderIds) {
      return this.upsertMember({ email: email, campaignFolderIds: Array.isArray(folderIds) ? folderIds : [] });
    },

    // Add / remove a single campaign assignment.
    assignCampaign: function (email, folderId) {
      var m = this.cachedMember(email) || { campaignFolderIds: [] };
      var set = (m.campaignFolderIds || []).slice();
      if (folderId && set.indexOf(folderId) < 0) set.push(folderId);
      return this.setAssignedCampaigns(email, set);
    },
    unassignCampaign: function (email, folderId) {
      var m = this.cachedMember(email) || { campaignFolderIds: [] };
      var set = (m.campaignFolderIds || []).filter(function (id) { return id !== folderId; });
      return this.setAssignedCampaigns(email, set);
    },

    removeMember: function (email) {
      email = normEmail(email);
      if (!email) return Promise.reject(new Error('removeMember: email required'));
      if (!this._db) return Promise.reject(new Error('Firestore not available'));
      return this._db.collection(COLLECTION).doc(email).delete();
    },

    // --- Campaign visibility -------------------------------------------------
    // Given a role + assigned folder ids, decide whether a campaign is visible.
    canSeeCampaign: function (role, assignedFolderIds, campaign) {
      if (this.can(role, 'seeAllCampaigns')) return true;
      if (!campaign) return false;
      var fid = campaign.driveFolderId || '';
      if (fid && assignedFolderIds && assignedFolderIds.indexOf(fid) >= 0) return true;
      return false;
    },

    // --- Campaign index ------------------------------------------------------
    // A lightweight, shared index of every campaign (NOT the campaign content —
    // that stays on Drive). Lets every admin discover the same campaigns
    // regardless of who created them. doc id = campaign id.
    _campaigns: [],
    _campUnsub: null,
    _onCampChange: null,
    _campReady: false,

    campaignsReady: function () { return this._campReady; },
    cachedCampaignIndex: function () { return this._campaigns.slice(); },

    _normCampaign: function (id, data) {
      data = data || {};
      return {
        id: data.id || id,
        name: data.name || '',
        client: data.client || '',
        clientEmail: normEmail(data.clientEmail || ''),
        driveFolderId: data.driveFolderId || '',
        driveFolderUrl: data.driveFolderUrl || '',
        driveDbFileId: data.driveDbFileId || '',
        updatedAt: data.updatedAt || '',
        updatedBy: data.updatedBy || ''
      };
    },

    subscribeCampaigns: function (onChange) {
      var self = this;
      this._onCampChange = typeof onChange === 'function' ? onChange : null;
      if (!this._db) {
        self._campReady = true;
        if (self._onCampChange) self._onCampChange(self.cachedCampaignIndex());
        return function () {};
      }
      if (this._campUnsub) { try { this._campUnsub(); } catch (e) {} this._campUnsub = null; }
      this._campUnsub = this._db.collection(COLLECTION_CAMPAIGNS).onSnapshot(function (snap) {
        var list = [];
        snap.forEach(function (doc) { list.push(self._normCampaign(doc.id, doc.data())); });
        self._campaigns = list;
        self._campReady = true;
        if (self._onCampChange) self._onCampChange(self.cachedCampaignIndex());
      }, function (err) {
        console.error('[Control] campaign snapshot error:', err);
        self._campReady = true;
        if (self._onCampChange) self._onCampChange(self.cachedCampaignIndex());
      });
      return this._campUnsub;
    },

    listCampaigns: function () {
      var self = this;
      if (!this._db) return Promise.resolve(this.cachedCampaignIndex());
      return this._db.collection(COLLECTION_CAMPAIGNS).get().then(function (snap) {
        var list = [];
        snap.forEach(function (doc) { list.push(self._normCampaign(doc.id, doc.data())); });
        self._campaigns = list;
        self._campReady = true;
        return self.cachedCampaignIndex();
      });
    },

    upsertCampaign: function (meta) {
      if (!meta || !meta.id) return Promise.reject(new Error('upsertCampaign: id required'));
      if (!this._db) return Promise.reject(new Error('Firestore not available'));
      var doc = {
        id: meta.id,
        name: meta.name || '',
        client: meta.client || '',
        clientEmail: normEmail(meta.clientEmail || ''),
        driveFolderId: meta.driveFolderId || '',
        driveFolderUrl: meta.driveFolderUrl || '',
        driveDbFileId: meta.driveDbFileId || '',
        updatedAt: new Date().toISOString(),
        updatedBy: meta.updatedBy || ''
      };
      return this._db.collection(COLLECTION_CAMPAIGNS).doc(meta.id).set(doc, { merge: true });
    },

    removeCampaign: function (id) {
      if (!id) return Promise.reject(new Error('removeCampaign: id required'));
      if (!this._db) return Promise.reject(new Error('Firestore not available'));
      return this._db.collection(COLLECTION_CAMPAIGNS).doc(id).delete();
    },

    // --- Presence (online Wkwk team) -----------------------------------------
    // Real-time online list shared across the team. Each member writes their
    // own doc (heartbeat) and everyone subscribes; stale entries are pruned by
    // lastSeen on the client side.
    _presence: [],
    _presenceUnsub: null,
    _onPresenceChange: null,

    heartbeatPresence: function (entry) {
      if (!entry || !entry.key || !this._db) return Promise.resolve();
      return this._db.collection(COLLECTION_PRESENCE).doc(entry.key).set({
        key: entry.key,
        name: entry.name || '',
        role: entry.role || '',
        avatar: entry.avatar || '',
        email: normEmail(entry.email || ''),
        lastSeen: new Date().toISOString()
      }, { merge: true });
    },

    subscribePresence: function (onChange) {
      var self = this;
      this._onPresenceChange = typeof onChange === 'function' ? onChange : null;
      if (!this._db) { if (self._onPresenceChange) self._onPresenceChange([]); return function () {}; }
      if (this._presenceUnsub) { try { this._presenceUnsub(); } catch (e) {} this._presenceUnsub = null; }
      this._presenceUnsub = this._db.collection(COLLECTION_PRESENCE).onSnapshot(function (snap) {
        var list = [];
        snap.forEach(function (doc) { list.push(doc.data()); });
        self._presence = list;
        if (self._onPresenceChange) self._onPresenceChange(list.slice());
      }, function (err) {
        console.error('[Control] presence snapshot error:', err);
        if (self._onPresenceChange) self._onPresenceChange(self._presence.slice());
      });
      return this._presenceUnsub;
    },

    removePresence: function (key) {
      if (!key || !this._db) return Promise.resolve();
      return this._db.collection(COLLECTION_PRESENCE).doc(key).delete();
    },

    // --- Editing indicator (multi-admin social-queue) -------------------------
    // Each admin writes {editingCampaignId, editingType, displayName, lastSeen}
    // into their own control_presence doc (existing rule: key must contain
    // request.auth.token.email — emails-as-keys satisfy that). Other admins
    // subscribe to the whole collection and surface a "🔴 X is editing this
    // campaign" banner on the matching campaign view. Lets the team coordinate
    // without the system having to serialize saves globally.
    _editing: [],
    _editingUnsub: null,
    _onEditingChange: null,

    setEditing: function (email, campaignId, modalType, displayName) {
      if (!this._db || !email) return Promise.resolve();
      var key = normEmail(email);
      return this._db.collection(COLLECTION_PRESENCE).doc(key).set({
        email: key,
        editingCampaignId: campaignId || '',
        editingType: modalType || '',
        displayName: displayName || '',
        lastSeen: new Date().toISOString()
      }, { merge: true });
    },

    clearEditing: function (email) {
      if (!this._db || !email) return Promise.resolve();
      var key = normEmail(email);
      // Don't delete the doc — other fields (legacy presence) might live there.
      // Just clear the editing-specific fields.
      return this._db.collection(COLLECTION_PRESENCE).doc(key).set({
        editingCampaignId: '',
        editingType: '',
        lastSeen: new Date().toISOString()
      }, { merge: true });
    },

    subscribeEditing: function (onChange) {
      var self = this;
      this._onEditingChange = typeof onChange === 'function' ? onChange : null;
      if (!this._db) {
        if (self._onEditingChange) self._onEditingChange([]);
        return function () {};
      }
      if (this._editingUnsub) { try { this._editingUnsub(); } catch (e) {} this._editingUnsub = null; }
      this._editingUnsub = this._db.collection(COLLECTION_PRESENCE).onSnapshot(function (snap) {
        var STALE_MS = 5 * 60 * 1000;
        var now = Date.now();
        var list = [];
        snap.forEach(function (doc) {
          var d = doc.data() || {};
          if (!d.editingCampaignId) return;
          // Stale entries (browser closed mid-edit, crashed) are ignored
          // client-side so the indicator doesn't stick forever.
          if (d.lastSeen) {
            var t = Date.parse(d.lastSeen);
            if (!isNaN(t) && now - t > STALE_MS) return;
          }
          list.push(d);
        });
        self._editing = list;
        if (self._onEditingChange) self._onEditingChange(list.slice());
      }, function (err) {
        console.error('[Control] editing snapshot error:', err);
      });
      return this._editingUnsub;
    },

    cachedEditing: function () { return this._editing.slice(); },

    // --- Signal channel (campaign change notifications) ----------------------
    // After saving a campaign JSON to Drive, the writer pings the corresponding
    // signal doc. Other clients listen via onSnapshot and surface a "Refresh"
    // banner. Drive remains the source of truth — the signal carries no data,
    // just { id, ts, modifiedBy, displayName }.
    _signals: {},           // id -> last seen signal { id, ts, modifiedBy, displayName }
    _signalUnsub: null,
    _onSignal: null,
    _selfSignalTs: {},      // id -> ts the local user wrote (to ignore own echoes)

    pingCampaignChanged: function (id, opts) {
      if (!id || !this._db) return Promise.resolve();
      opts = opts || {};
      var ts = Date.now();
      this._selfSignalTs[id] = ts;
      var doc = {
        id: id,
        ts: ts,
        iso: new Date(ts).toISOString(),
        modifiedBy: normEmail(opts.modifiedBy || ''),
        displayName: opts.displayName || '',
        deleted: false
      };
      return this._db.collection(COLLECTION_SIGNALS).doc(id).set(doc, { merge: true })
        .catch(function (e) {
          // Non-fatal: Drive save already succeeded; signal is a courtesy only.
          console.warn('[Control] pingCampaignChanged failed (non-fatal):', e);
        });
    },

    // Same channel, but flags the doc as a deletion. The receiver removes the
    // campaign from its local list. Drive is still source of truth — the file
    // was already trashed in the customer's Drive folder before this fires.
    pingCampaignDeleted: function (id, opts) {
      if (!id || !this._db) return Promise.resolve();
      opts = opts || {};
      var ts = Date.now();
      this._selfSignalTs[id] = ts;
      var doc = {
        id: id,
        ts: ts,
        iso: new Date(ts).toISOString(),
        modifiedBy: normEmail(opts.modifiedBy || ''),
        displayName: opts.displayName || '',
        deleted: true
      };
      return this._db.collection(COLLECTION_SIGNALS).doc(id).set(doc, { merge: true })
        .catch(function (e) {
          console.warn('[Control] pingCampaignDeleted failed (non-fatal):', e);
        });
    },

    cachedSignals: function () {
      var out = {};
      for (var k in this._signals) if (this._signals.hasOwnProperty(k)) out[k] = this._signals[k];
      return out;
    },

    subscribeSignals: function (onSignal) {
      var self = this;
      this._onSignal = typeof onSignal === 'function' ? onSignal : null;
      if (!this._db) return function () {};
      if (this._signalUnsub) { try { this._signalUnsub(); } catch (e) {} this._signalUnsub = null; }
      // Track first-snapshot so we don't blast banners for every doc that
      // already existed when the listener attached.
      var firstSnapshot = true;
      this._signalUnsub = this._db.collection(COLLECTION_SIGNALS).onSnapshot(function (snap) {
        snap.docChanges().forEach(function (change) {
          var data = change.doc.data() || {};
          var id = data.id || change.doc.id;
          var prev = self._signals[id];
          self._signals[id] = {
            id: id,
            ts: +data.ts || 0,
            iso: data.iso || '',
            modifiedBy: normEmail(data.modifiedBy || ''),
            displayName: data.displayName || '',
            deleted: !!data.deleted
          };
          if (firstSnapshot) return;                 // skip initial backfill
          if (change.type === 'removed') return;
          if (prev && prev.ts === self._signals[id].ts) return; // dedupe
          if (self._onSignal) self._onSignal(self._signals[id]);
        });
        firstSnapshot = false;
      }, function (err) {
        console.error('[Control] signal snapshot error:', err);
      });
      return this._signalUnsub;
    },

    // Returns true if this signal's ts was written by the local user (so the
    // caller can ignore its own echo without needing the email comparison).
    isOwnSignal: function (id, ts) {
      return this._selfSignalTs[id] === ts;
    }
  };

  window.Control = Control;
})();
