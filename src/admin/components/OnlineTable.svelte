<script lang="ts">
  import type { LivePlayer } from '../types';
  import { classLabel, zoneLabel, t } from '../i18n';
  import { fmtDuration } from '../format';

  // Live players table (refreshed every 5s by Overview). Ported from renderOnlineTable.
  let { players }: { players: LivePlayer[] } = $props();
</script>

{#if players.length === 0}
  <div class="empty">{t('online.empty')}</div>
{:else}
  <table>
    <thead>
      <tr>
        <th>{t('online.colCharacter')}</th>
        <th>{t('online.colClass')}</th>
        <th class="num">{t('online.colLevel')}</th>
        <th>{t('online.colZone')}</th>
        <th class="num">{t('online.colPos')}</th>
        <th class="num">{t('online.colHp')}</th>
        <th class="num">{t('online.colSession')}</th>
        <th class="num">{t('online.colLastSave')}</th>
        <th class="num">{t('online.colAcct')}</th>
      </tr>
    </thead>
    <tbody>
      {#each players as p}
        <tr>
          <td>{p.name}</td>
          <td>{classLabel(p.class)}</td>
          <td class="num">{p.level}</td>
          <td>{zoneLabel(p.zone)}</td>
          <td class="num">{Math.round(p.x)}, {Math.round(p.z)}</td>
          <td class="num">{p.hp}/{p.maxHp}</td>
          <td class="num">{fmtDuration(p.sessionSeconds)}</td>
          <td class="num">{t('common.ago', { value: fmtDuration(p.lastSaveSecondsAgo) })}</td>
          <td class="num">{p.accountId}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
