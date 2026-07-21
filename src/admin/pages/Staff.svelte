<script lang="ts">
  import { onMount } from 'svelte';
  import type { StaffData, StaffHistoryData, StaffRow } from '../types';
  import { apiGet, apiPost } from '../api';
  import { auth } from '../state/auth.svelte';
  import { localizeAdminError, t } from '../i18n';
  import { fmtDate } from '../format';
  import Panel from '../components/Panel.svelte';
  import Badge from '../components/Badge.svelte';

  // Staff role management. superadmin never appears in assignableRoles (it is
  // grantable only via scripts/grant_admin.mjs), so superadmin rows and the
  // operator's own row render read-only; the server refuses both anyway.
  let data = $state<StaffData | null>(null);
  let history = $state<StaffHistoryData | null>(null);
  let failed = $state(false);
  let edits = $state<Record<number, string[]>>({});
  let addUsername = $state('');
  let addRoles = $state<string[]>([]);
  let saving = $state(false);

  const KNOWN_ROLE_KEYS = new Set(['superadmin', 'admin', 'moderator', 'viewer']);

  function roleLabel(role: string): string {
    return KNOWN_ROLE_KEYS.has(role) ? t(`staff.role.${role}`) : role;
  }

  function isSuperadmin(row: StaffRow): boolean {
    return row.roles.includes('superadmin');
  }

  function isSelf(row: StaffRow): boolean {
    return row.username === auth.name;
  }

  function rowRoles(row: StaffRow): string[] {
    return edits[row.accountId] ?? row.roles;
  }

  function toggleRole(row: StaffRow, role: string): void {
    const current = new Set(rowRoles(row));
    if (current.has(role)) current.delete(role);
    else current.add(role);
    edits = { ...edits, [row.accountId]: order(current) };
  }

  function toggleAddRole(role: string): void {
    const current = new Set(addRoles);
    if (current.has(role)) current.delete(role);
    else current.add(role);
    addRoles = order(current);
  }

  function order(roles: ReadonlySet<string>): string[] {
    return (data?.assignableRoles ?? []).filter((role) => roles.has(role));
  }

  function isDirty(row: StaffRow): boolean {
    const edited = edits[row.accountId];
    return edited !== undefined && edited.join(',') !== row.roles.join(',');
  }

  // preserveEdits keeps other rows' unsaved checkbox state across the refresh
  // that follows a save; an edit that now matches the server row is dropped
  // (which also clears the just-saved row).
  async function refresh(preserveEdits = false): Promise<void> {
    try {
      const [staff, changes] = await Promise.all([
        apiGet<StaffData>('/admin/api/staff'),
        apiGet<StaffHistoryData>('/admin/api/staff/history'),
      ]);
      data = staff;
      history = changes;
      if (preserveEdits) {
        const next: Record<number, string[]> = {};
        for (const row of staff.rows) {
          const edited = edits[row.accountId];
          if (edited !== undefined && edited.join(',') !== row.roles.join(',')) {
            next[row.accountId] = edited;
          }
        }
        edits = next;
      } else {
        edits = {};
      }
      failed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  function fail(err: unknown, fallbackKey: string): void {
    if (!auth.handleAuthFailure(err)) {
      window.alert(err instanceof Error ? localizeAdminError(err.message) : t(fallbackKey));
    }
  }

  function saveRoles(username: string, roles: string[], revoking: boolean): void {
    if (revoking && !window.confirm(t('staff.confirmRevoke', { name: username }))) return;
    saving = true;
    apiPost('/admin/api/staff/roles', { username, roles })
      .then(() => refresh(true))
      .catch((err: unknown) => fail(err, 'staff.saveFailed'))
      .finally(() => {
        saving = false;
      });
  }

  function saveRow(row: StaffRow): void {
    saveRoles(row.username, rowRoles(row), rowRoles(row).length === 0);
  }

  function addStaff(e: SubmitEvent): void {
    e.preventDefault();
    const username = addUsername.trim();
    if (!username || addRoles.length === 0) return;
    saving = true;
    apiPost('/admin/api/staff/roles', { username, roles: addRoles })
      .then(() => {
        addUsername = '';
        addRoles = [];
        return refresh(true);
      })
      .catch((err: unknown) => fail(err, 'staff.saveFailed'))
      .finally(() => {
        saving = false;
      });
  }

  onMount(() => {
    void refresh();
  });
</script>

<Panel title={t('staff.addTitle')}>
  <form class="staff-add" onsubmit={addStaff}>
    <input
      class="staff-add-name"
      placeholder={t('staff.usernamePlaceholder')}
      maxlength="64"
      bind:value={addUsername}
    />
    {#each data?.assignableRoles ?? [] as role (role)}
      <label class="role-check">
        <input
          type="checkbox"
          checked={addRoles.includes(role)}
          onchange={() => toggleAddRole(role)}
        />
        {roleLabel(role)}
      </label>
    {/each}
    <button disabled={saving || !addUsername.trim() || addRoles.length === 0}>
      {t('staff.add')}
    </button>
  </form>
  <p class="hint">{t('staff.superadminHint')}</p>
</Panel>

<Panel title={t('staff.listTitle')}>
  {#if failed}
    <div class="empty">{t('staff.loadFailed')}</div>
  {:else if data && data.rows.length === 0}
    <div class="empty">{t('staff.empty')}</div>
  {:else if data}
    <table>
      <thead>
        <tr>
          <th>{t('staff.colUsername')}</th>
          <th>{t('staff.colRoles')}</th>
          <th>{t('staff.colLastLogin')}</th>
          <th>{t('detail.colActions')}</th>
        </tr>
      </thead>
      <tbody>
        {#each data.rows as row (row.accountId)}
          <tr>
            <td>{row.username}</td>
            <td>
              {#if isSuperadmin(row) || isSelf(row)}
                {#each row.roles as role (role)}
                  <Badge variant={role === 'superadmin' ? 'warn' : undefined}>
                    {roleLabel(role)}
                  </Badge>
                {/each}
              {:else}
                {#each data.assignableRoles as role (role)}
                  <label class="role-check">
                    <input
                      type="checkbox"
                      checked={rowRoles(row).includes(role)}
                      onchange={() => toggleRole(row, role)}
                    />
                    {roleLabel(role)}
                  </label>
                {/each}
              {/if}
            </td>
            <td>{row.lastLogin ? fmtDate(row.lastLogin) : t('common.emptyValue')}</td>
            <td>
              {#if isSuperadmin(row)}
                <span class="hint">{t('staff.managedByScript')}</span>
              {:else if isSelf(row)}
                <span class="hint">{t('staff.ownAccount')}</span>
              {:else}
                <button disabled={saving || !isDirty(row)} onclick={() => saveRow(row)}>
                  {t('staff.save')}
                </button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</Panel>

<Panel title={t('staff.historyTitle')}>
  {#if history && history.rows.length === 0}
    <div class="empty">{t('staff.historyEmpty')}</div>
  {:else if history}
    <table>
      <thead>
        <tr>
          <th>{t('staff.colWhen')}</th>
          <th>{t('staff.colUsername')}</th>
          <th>{t('staff.colBefore')}</th>
          <th>{t('staff.colAfter')}</th>
          <th>{t('staff.colChangedBy')}</th>
        </tr>
      </thead>
      <tbody>
        {#each history.rows as row (row.id)}
          <tr>
            <td>{fmtDate(row.createdAt)}</td>
            <td>{row.username ?? t('common.unknown')}</td>
            <td>{row.rolesBefore.map(roleLabel).join(', ') || t('common.emptyValue')}</td>
            <td>{row.rolesAfter.map(roleLabel).join(', ') || t('common.emptyValue')}</td>
            <td>{row.adminUsername ?? t('staff.viaScript')}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</Panel>

<style>
  .staff-add {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }

  .staff-add-name {
    min-width: 200px;
  }

  .role-check {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-right: 10px;
    white-space: nowrap;
  }

  .hint {
    color: var(--text-dim);
    font-size: 12px;
  }

  td .role-check {
    margin-right: 12px;
  }
</style>
