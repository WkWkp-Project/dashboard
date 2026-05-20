# Admin RBAC rollout plan (minimal-impact)

This document describes a low-risk rollout to add role-based admin/member/campaign assignment without changing campaign content flow.

## Goals
- Add first-class roles: `admin`, `editor`, `operation`, `viewer`.
- Admin can manage all members and assignments.
- Editor can edit only assigned campaigns; cannot manage members.
- Operation can operate assigned campaigns with limited write actions.
- Viewer can only read assigned campaigns.
- Keep existing Google/Firebase login and Google Drive campaign storage flow unchanged.

## Current constraints
- Admin is currently inferred by email domain (`@team.wkwkp.com`).
- Campaign read visibility is currently owner-email based (`clientEmail`).
- `index.html` contains auth, role gating, and UI logic in a single monolith.

## Proposed model

### Collections
1. `users/{email}`
   - `roles: string[]`
   - `displayName: string`
   - `status: 'active' | 'disabled'`
   - `createdAt`, `updatedAt`

2. `campaign_permissions/{campaignId}/users/{email}`
   - `canView: boolean`
   - `canEdit: boolean`
   - `canOperate: boolean`
   - `canAssign: boolean`
   - `assignedBy`, `assignedAt`

3. `campaigns/{id}` (existing)
   - Keep existing campaign payload and drive linkage.

## Bootstrap first admin
- Use allowlist bootstrap email(s) for first deploy only.
- On first login of allowlisted email, create `users/{email}` with `roles=['admin']`.
- Disable bootstrap after initial setup.

## Rollout phases

### Phase 1: Data and rule scaffolding
- Add users + campaign permissions collections.
- Add rule helpers for `hasRole`, `canViewCampaign`, `canEditCampaign`, `canManageUsers`.
- Keep backward-compatible owner/domain fallback during migration window.

### Phase 2: UI and module split
- Extract role/permission checks into dedicated JS module(s).
- Add Admin panel section for users + roles + campaign assignment.
- Hide/disable privileged controls for non-admin roles.

### Phase 3: Migration
- Backfill permissions from current `campaign.clientEmail` ownership.
- Verify campaign visibility parity before enabling strict ACL mode.

### Phase 4: Cutover
- Remove legacy owner/domain checks (optional after verification period).

## QA checklist
1. Admin login:
   - Can list all members.
   - Can add/remove member.
   - Can assign/unassign campaigns.
2. Editor login:
   - Sees only assigned campaigns.
   - Can edit campaign content.
   - Cannot delete members or manage roles.
3. Operation login:
   - Sees assigned campaigns.
   - Can perform operational actions only.
4. Viewer login:
   - Sees assigned campaigns read-only.
5. Regression:
   - Drive campaign JSON/media upload continues to function.
   - Existing handoff/export flow remains unchanged.

## Non-goals for this rollout
- Replacing Google/Firebase authentication.
- Replacing Google Drive as campaign file storage.
