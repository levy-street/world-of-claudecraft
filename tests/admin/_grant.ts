// Grants dashboard permissions on the auth singleton for component tests (the
// client permission state is presentation-only; the server re-checks every
// call). Default is the full set so pre-permissions tests render everything;
// gating tests pass a narrower set.
import { ADMIN_PERMISSIONS, type AdminPermission } from '../../src/admin/permissions';
import { auth } from '../../src/admin/state/auth.svelte';

export function grantPermissions(
  permissions: readonly AdminPermission[] = ADMIN_PERMISSIONS,
): void {
  auth.permissions = [...permissions];
  auth.permissionsLoaded = true;
}
