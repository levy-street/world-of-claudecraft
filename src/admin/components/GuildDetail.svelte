<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    GuildDetailData,
    GuildRenameHistoryData,
  } from '../types';
  import type { GuildRenameBody } from '../guild_rename';
  import { apiGet, apiPost } from '../api';
  import { auth } from '../state/auth.svelte';
  import { LIVE_REFRESH_MS, poll } from '../state/poll';
  import { classLabel, localizeAdminError, t } from '../i18n';
  import { fmtDate, fmtNumber, fmtRelative } from '../format';
  import { guildRankLabel } from '../labels';
  import {
    getAdminNavigation,
    routeHref,
  } from '../navigation';
  import AccountLink from './AccountLink.svelte';
  import Badge from './Badge.svelte';
  import GuildBankPanel from './GuildBankPanel.svelte';
  import GuildRenameDialog from './GuildRenameDialog.svelte';
  import Panel from './Panel.svelte';

  let { guildId }: { guildId: number } = $props();

  const navigation = getAdminNavigation();
  let detail = $state<GuildDetailData | null>(null);
  let history = $state<GuildRenameHistoryData | null>(null);
  let failed = $state(false);
  let historyFailed = $state(false);
  let renameOpen = $state(false);
  let renaming = $state(false);
  let detailRequest: Promise<void> | null = null;
  let historyRequestEpoch = 0;
  // The bank read and the rename audit share moderation.read: both are records
  // of a guild's private business rather than its public roster. The bank
  // panel's own destructive action is gated separately inside it.
  let canViewHistory = $derived(auth.can('moderation.read'));
  let canViewBank = $derived(canViewHistory);
  let canRename = $derived(auth.can('moderation.act'));

  async function loadDetail(requireFresh = false): Promise<void> {
    if (detailRequest) {
      await detailRequest;
      if (requireFresh) return loadDetail();
      return;
    }
    const request = (async () => {
      try {
        detail = await apiGet<GuildDetailData>(`/admin/api/guilds/${guildId}`);
        failed = false;
      } catch (err) {
        if (!auth.handleAuthFailure(err)) failed = true;
      }
    })();
    detailRequest = request;
    try {
      await request;
    } finally {
      if (detailRequest === request) detailRequest = null;
    }
  }

  async function loadHistory(): Promise<void> {
    if (!canViewHistory) return;
    const epoch = ++historyRequestEpoch;
    try {
      const next = await apiGet<GuildRenameHistoryData>(
        `/admin/api/guilds/${guildId}/history`,
      );
      if (epoch !== historyRequestEpoch) return;
      history = next;
      historyFailed = false;
    } catch (err) {
      if (epoch === historyRequestEpoch && !auth.handleAuthFailure(err)) historyFailed = true;
    }
  }

  async function rename(body: GuildRenameBody): Promise<void> {
    if (renaming) return;
    renaming = true;
    try {
      await apiPost(`/admin/api/guilds/${guildId}/rename`, body);
      renameOpen = false;
      await Promise.all([loadDetail(true), loadHistory()]);
    } catch (err) {
      if (!auth.handleAuthFailure(err)) {
        window.alert(
          err instanceof Error ? localizeAdminError(err.message) : t('guilds.renameFailed'),
        );
      }
    } finally {
      renaming = false;
    }
  }

  onMount(() => {
    void loadHistory();
    return poll(() => void loadDetail(), LIVE_REFRESH_MS);
  });
</script>

<p>
  <a
    href={routeHref({ page: 'guilds' })}
    onclick={(event) => navigation?.navigate(event, { page: 'guilds' })}
  >{t('guilds.backToList')}</a>
</p>

{#if failed}
  <Panel>
    <div class="empty">{t('guilds.detailLoadFailed')}</div>
  </Panel>
{:else if detail}
  <Panel title={detail.guild.name}>
    <div class="guild-summary">
      <dl>
        <div>
          <dt>{t('guilds.colId')}</dt>
          <dd>{fmtNumber(detail.guild.id)}</dd>
        </div>
        <div>
          <dt>{t('guilds.colRealm')}</dt>
          <dd>{detail.guild.realm}</dd>
        </div>
        <div>
          <dt>{t('guilds.colCreated')}</dt>
          <dd>{fmtDate(detail.guild.createdAt)}</dd>
        </div>
        <div>
          <dt>{t('guilds.colMembers')}</dt>
          <dd>{fmtNumber(detail.guild.memberCount)}</dd>
        </div>
      </dl>
      {#if canRename}
        <button class="danger" type="button" onclick={() => (renameOpen = true)}>
          {t('guilds.renameAction')}
        </button>
      {/if}
    </div>
  </Panel>

  <Panel title={t('guilds.membersTitle')}>
    {#if detail.members.length === 0}
      <div class="empty">{t('guilds.membersEmpty')}</div>
    {:else}
      {#if detail.guild.memberCount > detail.members.length}
        <p class="members-truncated">
          {t('guilds.membersTruncated', {
            shown: fmtNumber(detail.members.length),
            total: fmtNumber(detail.guild.memberCount),
          })}
        </p>
      {/if}
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t('guilds.memberCharacter')}</th>
              <th>{t('characters.colAccount')}</th>
              <th>{t('characters.colClass')}</th>
              <th class="num">{t('characters.colLevel')}</th>
              <th>{t('guilds.memberRank')}</th>
              <th>{t('guilds.memberJoined')}</th>
              <th>{t('guilds.memberLastLogin')}</th>
              <th>{t('guilds.memberStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {#each detail.members as member (member.characterId)}
              <tr>
                <td>{member.characterName}</td>
                <td><AccountLink accountId={member.accountId} label={member.username} /></td>
                <td>{classLabel(member.class)}</td>
                <td class="num">{fmtNumber(member.level)}</td>
                <td>{guildRankLabel(member.rank)}</td>
                <td>{fmtDate(member.joinedAt)}</td>
                <td>{fmtRelative(member.lastLogin)}</td>
                <td>
                  <Badge variant={member.online ? 'success' : 'neutral'}>
                    {member.online ? t('guilds.online') : t('guilds.offline')}
                  </Badge>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </Panel>

  {#if canViewBank}
    <GuildBankPanel {guildId} />
  {/if}

  {#if canViewHistory}
    <Panel title={t('guilds.historyTitle')}>
      {#if historyFailed}
        <div class="empty">{t('guilds.historyLoadFailed')}</div>
      {:else if history && history.rows.length === 0}
        <div class="empty">{t('guilds.historyEmpty')}</div>
      {:else if history}
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t('guilds.historyWhen')}</th>
                <th>{t('guilds.historyOldName')}</th>
                <th>{t('guilds.renameNewName')}</th>
                <th>{t('guilds.historyReason')}</th>
                <th>{t('guilds.historyAdmin')}</th>
              </tr>
            </thead>
            <tbody>
              {#each history.rows as row (row.id)}
                <tr>
                  <td>{fmtDate(row.createdAt)}</td>
                  <td>{row.oldName}</td>
                  <td>{row.newName}</td>
                  <td>{row.reason}</td>
                  <td>{row.adminUsername ?? t('common.unknown')}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </Panel>
  {/if}

  {#if renameOpen}
    <GuildRenameDialog
      currentName={detail.guild.name}
      submitting={renaming}
      onConfirm={rename}
      onClose={() => {
        if (!renaming) renameOpen = false;
      }}
    />
  {/if}
{/if}

<style>
  .guild-summary {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
  }

  dl {
    display: flex;
    flex-wrap: wrap;
    gap: 18px 32px;
    margin: 0;
  }

  dl div {
    display: grid;
    gap: 3px;
  }

  dt {
    color: var(--text-dim);
    font-size: 12px;
  }

  dd {
    margin: 0;
    color: var(--text-bright);
  }

  button.danger {
    border-color: var(--color-danger-border);
    color: var(--color-danger);
  }

  .members-truncated {
    margin: 0 0 12px;
    color: var(--text-dim);
    font-size: 12px;
  }

  @media (max-width: 640px) {
    .guild-summary {
      display: grid;
    }
  }
</style>
