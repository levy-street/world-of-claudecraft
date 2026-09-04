<script lang="ts">
  // The ONE permission-denied treatment every admin data surface renders when
  // its read answered 403. Reused before bespoke by ruling: the generic
  // `<domain>.loadFailed` line stays each surface's own copy, but the 403 arm
  // reads identically everywhere, because "your roles do not carry this
  // permission" is the same fact on every page and an operator who learns it
  // once should recognise it anywhere (see src/admin/load_failure.ts for why
  // 403 is the one failure worth separating).
  //
  // role="status", not "alert": nothing here is urgent or time-critical, and a
  // polling surface would otherwise re-interrupt a screen reader on every
  // refused refresh.
  import { onMount } from 'svelte';
  import { t } from '../i18n';

  let announce = $state(false);

  onMount(() => {
    // This component appears only after an asynchronous 403. Mount the empty
    // live region first, then populate it in a later task: inserting a status
    // region with its message already present is not announced consistently.
    const timer = window.setTimeout(() => {
      announce = true;
    }, 0);
    return () => window.clearTimeout(timer);
  });
</script>

<div class="permission-denied">
  <div class="permission-denied-copy" aria-hidden="true">
    <strong>{t('loadFailure.forbiddenTitle')}</strong>
    <span>{t('loadFailure.forbiddenDetail')}</span>
  </div>
  <p class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
    {#if announce}
      <span>{t('loadFailure.forbiddenTitle')}</span>
      <span>{t('loadFailure.forbiddenDetail')}</span>
    {/if}
  </p>
</div>

<style>
  /* Deliberately NOT the `.empty` italic-dim treatment the generic arm uses:
     the whole point is that an operator can tell the two apart at a glance. */
  .permission-denied {
    padding: 14px 12px;
    color: var(--text);
    background: var(--surface-sunken);
    border-left: 3px solid var(--badge-warn-text);
    border-radius: 2px;
  }

  .permission-denied-copy {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .permission-denied strong {
    color: var(--badge-warn-text);
  }

  .permission-denied span {
    color: var(--text-soft);
    line-height: 1.5;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
