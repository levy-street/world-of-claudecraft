<script lang="ts">
  import {
    factorDeltaPercent,
    isNeutral,
    TUNING_FACTOR_STEP,
    TUNING_MAX_FACTOR,
    TUNING_MIN_FACTOR,
    TUNING_NEUTRAL_FACTOR,
    weaponPreview,
  } from '../class_tuning';
  import { fmtDecimal } from '../format';
  import { t } from '../i18n';
  import type { TunerWeaponInfo } from '../types';
  import Badge from './Badge.svelte';

  // One weapon's auto-attack ("white") card: the swing damage roll and the swing
  // timer, with the resulting damage-per-second alongside so an operator can see
  // what a nerf actually costs. Covers carried weapon items and the per-class
  // ranged profile a hunter's Auto Shot and a caster's wand swing with.
  let {
    weapon,
    factors = $bindable(),
    readOnly = false,
    onReset,
  }: {
    weapon: TunerWeaponInfo;
    factors: Record<string, number>;
    readOnly?: boolean;
    onReset: (weaponId: string) => void;
  } = $props();

  const preview = $derived(weaponPreview(weapon, factors));
  const tunedCount = $derived(
    Object.values(factors ?? {}).filter((factor) => !isNeutral(factor)).length,
  );

  function channelLabel(channel: string): string {
    return t(`tuning.channel.${channel}`);
  }
</script>

<article class="weapon" class:tuned={tunedCount > 0}>
  <header class="weapon-head">
    <div class="weapon-title">
      <h3>{weapon.name}</h3>
      <code class="weapon-id">{weapon.id}</code>
    </div>
    <div class="weapon-meta">
      <Badge variant="neutral">{t(`tuning.hand.${weapon.hand}`)}</Badge>
      {#if weapon.dagger}<Badge variant="neutral">{t('tuning.dagger')}</Badge>{/if}
      {#if weapon.kind === 'classRanged'}<Badge>{t('tuning.classKit')}</Badge>{/if}
      {#if tunedCount > 0}
        <button type="button" class="reset" onclick={() => onReset(weapon.id)} disabled={readOnly}>
          {t('tuning.resetAbility')}
        </button>
      {/if}
    </div>
  </header>

  <p class="profile">
    <span class="profile-label">{t('tuning.baseValues')}</span>
    <span>
      {t('tuning.swingProfile', {
        min: fmtDecimal(weapon.min, 2),
        max: fmtDecimal(weapon.max, 2),
        speed: fmtDecimal(weapon.speed, 2),
        dps: fmtDecimal(weapon.dps, 2),
      })}
    </span>
    {#if !preview.unchanged}
      <span class="arrow" aria-hidden="true">-&gt;</span>
      <span class="profile-label">{t('tuning.tunedValues')}</span>
      <span class="tuned-profile">
        {t('tuning.swingProfile', {
          min: fmtDecimal(preview.min, 2),
          max: fmtDecimal(preview.max, 2),
          speed: fmtDecimal(preview.speed, 2),
          dps: fmtDecimal(preview.dps, 2),
        })}
      </span>
    {/if}
  </p>

  <div class="channels">
    {#each weapon.channels as channel (channel.channel)}
      {@const factor = factors[channel.channel] ?? TUNING_NEUTRAL_FACTOR}
      {@const delta = factorDeltaPercent(factor)}
      <div class="channel" class:moved={!isNeutral(factor)}>
        <label class="channel-label" for={`slider-${weapon.id}-${channel.channel}`}>
          {channelLabel(channel.channel)}
        </label>
        <div class="channel-control">
          <input
            id={`slider-${weapon.id}-${channel.channel}`}
            type="range"
            min={TUNING_MIN_FACTOR}
            max={TUNING_MAX_FACTOR}
            step={TUNING_FACTOR_STEP}
            disabled={readOnly}
            bind:value={factors[channel.channel]}
          />
          <output class="factor" class:up={delta > 0} class:down={delta < 0}>
            {fmtDecimal(factor, 2)}x
            {#if delta !== 0}<span class="delta">({delta > 0 ? '+' : ''}{delta}%)</span>{/if}
          </output>
        </div>
      </div>
    {/each}
  </div>
</article>

<style>
  .weapon {
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 12px 14px;
  }

  .weapon.tuned {
    border-color: var(--gold);
  }

  .weapon-head {
    align-items: baseline;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .weapon-title {
    align-items: baseline;
    display: flex;
    gap: 8px;
    min-width: 0;
  }

  h3 {
    color: var(--text-bright);
    font-family: var(--title-font);
    font-size: 16px;
    font-weight: 600;
  }

  .weapon-id {
    color: var(--text-soft);
    font-size: var(--font-size-small);
  }

  .weapon-meta {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 6px;
  }

  .reset {
    background: none;
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--text-soft);
    cursor: pointer;
    font-size: var(--font-size-small);
    padding: 2px 8px;
  }

  .reset:hover:not(:disabled) {
    border-color: var(--gold);
    color: var(--text-bright);
  }

  .reset:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .profile {
    color: var(--text-soft);
    display: flex;
    flex-wrap: wrap;
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
    gap: 4px 8px;
    margin-bottom: 8px;
  }

  .profile-label {
    opacity: 0.7;
  }

  .tuned-profile {
    color: var(--gold);
  }

  .channels {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  }

  .channel {
    border-left: 2px solid var(--border);
    padding-left: 10px;
  }

  .channel.moved {
    border-left-color: var(--gold);
  }

  .channel-label {
    color: var(--text-bright);
    display: block;
    font-size: var(--font-size-small);
    margin-bottom: 4px;
  }

  .channel-control {
    align-items: center;
    display: flex;
    gap: 8px;
  }

  input[type='range'] {
    accent-color: var(--gold);
    flex: 1;
    min-width: 120px;
  }

  .factor {
    color: var(--text-soft);
    flex: none;
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
    min-width: 84px;
    text-align: right;
  }

  .factor.up {
    color: var(--badge-success-text);
  }

  .factor.down {
    color: var(--color-danger);
  }

  .delta {
    margin-left: 3px;
  }

  @media (pointer: coarse) {
    .channels {
      grid-template-columns: 1fr;
    }
  }
</style>
