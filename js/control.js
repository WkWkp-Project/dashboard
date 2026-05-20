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

  // --- Role / permission matrix --------------------------------------------
  // Keep this declarative so UI gates read from one place.
  var ROLES = ['admin', 'editor', 'operation', 'viewer', 'customer'];

  var PERMISSIONS = {
    admin:     { manageMembers: true,  manageAdmins: true,  seeAllCampaigns: true,  assignCampaign: true,  createCampaign: true,  deleteCampaign: true,  editSectionA: true,  editSectionB: true },
    editor:    { manageMembers: false, manageAdmins: false, seeAllCampaigns: false, assignCampaign: false, createCampaign: false, deleteCampaign: false, editSectionA: true,  editSectionB: true },
    operation: { manageMembers: false, manageAdmins: false, seeAllCampaigns: false, assignCampaign: false, createCampaign: false, deleteCampaign: false, editSectionA: false, editSectionB: true },
    viewer:    { manageMembers: false, manageAdmins: false, seeAllCampaigns: false, assignCampaign: false, createCampaign: false, deleteCampaign: false, editSectionA: false, editSectionB: false },
    customer:  { manageMembers: false, manageAdmins: false, seeAllCampaigns: false, assignCampaign: false, createCampaign: false, deleteCampaign: false, editSectionA: false, editSectionB: true }
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
    }
  };

  window.Control = Control;
})();
