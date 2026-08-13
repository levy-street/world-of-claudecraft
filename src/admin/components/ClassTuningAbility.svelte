<script lang="ts">
  import {
    channelPreview,
    factorDeltaPercent,
    isNeutral,
    TUNING_FACTOR_STEP,
    TUNING_MAX_FACTOR,
    TUNING_MIN_FACTOR,
    TUNING_NEUTRAL_FACTOR,
  } from '../class_tuning';
  import { fmtDecimal } from '../format';
  import { t } from '../i18n';
  import Badge from './Badge.svelte';
  import type { TunerAbilityInfo, TunerSpecInfo } from '../types';

  // One ability's card: a slider per tuning channel the ability exposes, each
  // showing the shipped numbers and, once moved, what they become. The channel
  // set is server data derived from the ability's own effects, so a reworked
  // class gets the right sliders with no change here.
  let {
    ability,
    factors = $bindable(),
    specs,
    readOnly = false,
    onReset,
  }: {
    ability: TunerAbilityInfo;
    factors: Record<string, number>;
    specs: TunerSpecInfo[];
    readOnly?: boolean;
    onReset: (abilityId: string) => void;
  } = $props();

  const SOURCE_KEYS: Record<string, string> = {
    base: 'tuning.sourceBase',
    spec: 'tuning.sourceSpec',
    signature: 'tuning.sourceSignature',
    row: 'tuning.sourceRow',
    unspecced: 'tuning.sourceUnspecced',
  };

  const tunedCount = $derived(
    Object.values(factors ?? {}).filter((factor) => !isNeutral(factor)).length,
  );

  function specName(specId: string): string {
    return specs.find((spec) => spec.id === specId)?.name ?? specId;
  }

  // Channel ids and ability sources are CLOSED vocabularies from the sim, so
  // both label sets are real t() keys built from the id. The keys are dynamic,
  // which the admin catalog's literal scan cannot see, so
  // tests/admin/class_tuning.test.ts pins one key per channel and per source
  // against the live vocabulary instead.
  function channelLabel(channel: string): string {
    return t(`tuning.channel.${channel}`);
  }

  function sourceLabel(source: string): string {
    return t(SOURCE_KEYS[source] ?? 'tuning.sourceBase');
  }

  function readout(values: number[]): string {
    return values.map((value) => fmtDecimal(value, 4)).join(' / ');
  }
</script>

<article class="ability" class:tuned={tunedCount > 0}>
  <header class="ability-head">
    <div class="ability-title">
      <h3>{ability.name}</h3>
      <code class="ability-id">{ability.id}</code>
    </div>
    <div class="ability-meta">
      <Badge variant="neutral">{t('tuning.learnLevel', { level: ability.learnLevel })}</Badge>
      {#if ability.ranks > 1}
        <Badge variant="neutral">{t('tuning.ranks', { count: ability.ranks })}</Badge>
      {/if}
      {#if ability.passive}<Badge variant="neutral">{t('tuning.passive')}</Badge>{/if}
      <Badge>{sourceLabel(ability.source)}</Badge>
      {#each ability.specs as specId (specId)}
        <Badge variant="neutral">{specName(specId)}</Badge>
      {/each}
      {#if tunedCount > 0}
        <Badge variant="warn">{t('tuning.channelCount', { count: tunedCount })}</Badge>
        <button type="button" class="reset" onclick={() => onReset(ability.id)} disabled={readOnly}>
          {t('tuning.resetAbility')}
        </button>
      {/if}
    </div>
  </header>

  {#if ability.channels.length === 0}
    <p class="empty">{t('tuning.noChannels')}</p>
  {:else}
    <div class="channels">
      {#each ability.channels as channel (channel.channel)}
        {@const factor = factors[channel.channel] ?? TUNING_NEUTRAL_FACTOR}
        {@const preview = channelPreview(channel, factor)}
        {@const delta = factorDeltaPercent(factor)}
        <div class="channel" class:moved={!isNeutral(factor)}>
          <label class="channel-label" for={`slider-${ability.id}-${channel.channel}`}>
            {channelLabel(channel.channel)}
          </label>
          <div class="channel-control">
            <input
              id={`slider-${ability.id}-${channel.channel}`}
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
          <p class="values">
            <span class="values-label">{t('tuning.baseValues')}</span>
            <span class="base">{readout(preview.base)}</span>
            {#if !preview.unchanged}
              <span class="arrow" aria-hidden="true">-&gt;</span>
              <span class="values-label">{t('tuning.tunedValues')}</span>
              <span class="tuned-values">{readout(preview.tuned)}</span>
            {/if}
          </p>
        </div>
      {/each}
    </div>
  {/if}
</article>

<style>
  .ability {
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface-inset);
    padding: 12px 14px;
  }

  .ability.tuned {
    border-color: var(--gold);
  }

  .ability-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 6px 12px;
    margin-bottom: 10px;
  }

  .ability-title {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }

  h3 {
    color: var(--text-bright);
    font-family: var(--title-font);
    font-size: 16px;
    font-weight: 600;
  }

  .ability-id {
    color: var(--text-soft);
    font-size: var(--font-size-small);
  }

  .ability-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
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
    color: var(--text-bright);
    border-color: var(--gold);
  }

  .reset:disabled {
    cursor: not-allowed;
    opacity: 0.5;
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

  .values {
    color: var(--text-soft);
    display: flex;
    flex-wrap: wrap;
    gap: 4px 6px;
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
    margin-top: 4px;
  }

  .values-label {
    opacity: 0.7;
  }

  .tuned-values {
    color: var(--gold);
  }

  .empty {
    color: var(--text-soft);
    font-size: var(--font-size-small);
  }

  /* iOS Safari zooms any control under 16px on focus; the range input is not a
     text field, but the reset button and readouts sit beside real inputs on this
     page, so keep the touch floor consistent with styles/base.css. */
  @media (pointer: coarse) {
    .channels {
      grid-template-columns: 1fr;
    }
  }
</style>
