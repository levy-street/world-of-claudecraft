<script lang="ts">
  import { onMount } from 'svelte';
  import { apiGet } from '../api';
  import Badge from '../components/Badge.svelte';
  import HkStatusBanner from '../components/HkStatusBanner.svelte';
  import Panel from '../components/Panel.svelte';
  import { fmtCopper } from '../format';
  import { t } from '../i18n';
  import { auth } from '../state/auth.svelte';
  import type { HkWorldCatalog } from '../types';

  // World reference: zones, dungeons, and delves at a glance (read-only; the
  // spawn/mob/quest panels are where the numbers get edited).
  let data = $state<HkWorldCatalog | null>(null);
  let failed = $state(false);

  async function refresh(): Promise<void> {
    try {
      data = await apiGet<HkWorldCatalog>('/admin/api/housekeeping/world');
      failed = false;
    } catch (err) {
      if (!auth.handleAuthFailure(err)) failed = true;
    }
  }

  onMount(() => {
    void refresh();
  });
</script>

{#if failed}
  <Panel title={t('nav.hkWorld')}><div class="empty">{t('housekeeping.loadFailed')}</div></Panel>
{:else if data}
  <HkStatusBanner status={data.status} />

  <Panel title={t('hkWorld.zonesTitle')} hint={t('hkWorld.zonesHint')}>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{t('hkWorld.colZone')}</th>
            <th>{t('hkWorld.colLevels')}</th>
            <th>{t('hkWorld.colBiome')}</th>
            <th>{t('hkWorld.colHub')}</th>
            <th class="num">{t('housekeeping.countCamps')}</th>
            <th class="num">{t('housekeeping.countNpcs')}</th>
            <th class="num">{t('housekeeping.countQuests')}</th>
            <th>{t('hkWorld.colPois')}</th>
          </tr>
        </thead>
        <tbody>
          {#each data.zones as zone (zone.id)}
            <tr>
              <td>{zone.name} <span class="hk-id">{zone.id}</span></td>
              <td>{zone.levelRange[0]}..{zone.levelRange[1]}</td>
              <td>{zone.biome}</td>
              <td>{zone.hubName}</td>
              <td class="num">{zone.campCount}</td>
              <td class="num">{zone.npcCount}</td>
              <td class="num">{zone.questCount}</td>
              <td>{zone.pois.join(', ')}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </Panel>

  <Panel title={t('hkWorld.dungeonsTitle')} hint={t('hkWorld.dungeonsHint')}>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{t('hkWorld.colDungeon')}</th>
            <th class="num">{t('hkWorld.colSuggested')}</th>
            <th class="num">{t('hkWorld.colSpawns')}</th>
            <th>{t('hkWorld.colBosses')}</th>
            <th>{t('hkWorld.colDoor')}</th>
          </tr>
        </thead>
        <tbody>
          {#each data.dungeons as dungeon (dungeon.id)}
            <tr>
              <td>{dungeon.name} <span class="hk-id">{dungeon.id}</span></td>
              <td class="num">{dungeon.suggestedPlayers}</td>
              <td class="num">{dungeon.spawnCount}</td>
              <td>{dungeon.bossNames.join(', ') || t('common.emptyValue')}</td>
              <td>
                {#if dungeon.overworldDoor}<Badge>{t('hkWorld.doorOverworld')}</Badge>
                {:else}<Badge variant="neutral">{t('hkWorld.doorInternal')}</Badge>{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </Panel>

  <Panel title={t('hkWorld.delvesTitle')} hint={t('hkWorld.delvesHint')}>
    {#each data.delves as delve (delve.id)}
      <div class="hk-delve">
        <div class="hk-delve-head">
          <strong>{delve.name}</strong>
          <span class="hk-id">{delve.id}</span>
          <Badge>{t('hkWorld.delveMinLevel', { value: String(delve.minLevel) })}</Badge>
          <Badge variant="neutral">
            {t('hkWorld.delveSuggested', { value: String(delve.suggestedPlayers) })}
          </Badge>
        </div>
        <div class="hint">
          {t('hkWorld.colBosses')}: {delve.bosses.join(', ') || t('common.emptyValue')}
        </div>
        <div class="hint">
          {t('hkWorld.delveRewards', {
            copperMin: fmtCopper(delve.baseRewards.copperMin),
            copperMax: fmtCopper(delve.baseRewards.copperMax),
            firstXp: String(delve.baseRewards.firstClearXp),
            repeatXp: String(delve.baseRewards.repeatClearXp),
          })}
        </div>
        <table class="hk-tiers">
          <thead>
            <tr>
              <th>{t('hkWorld.colTier')}</th>
              <th class="num">{t('hkWorld.colLevelBonus')}</th>
              <th class="num">{t('hkWorld.colAffixes')}</th>
              <th class="num">{t('hkWorld.colRewardMult')}</th>
            </tr>
          </thead>
          <tbody>
            {#each delve.tiers as tier (tier.id)}
              <tr>
                <td>{tier.label}</td>
                <td class="num">+{tier.enemyLevelBonus}</td>
                <td class="num">{tier.affixCount}</td>
                <td class="num">x{tier.rewardMult}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/each}
  </Panel>
{/if}

<style>
  .hk-id {
    margin-left: 6px;
    color: var(--text-dim);
    font-size: var(--font-size-small);
  }
  .hk-delve {
    margin-bottom: 16px;
  }
  .hk-delve-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
    color: var(--text-bright);
  }
  .hk-tiers {
    margin-top: 6px;
    max-width: 520px;
  }
</style>
