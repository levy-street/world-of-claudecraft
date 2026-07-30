<script lang="ts">
  import { untrack } from 'svelte';
  import type { AccountDetail } from '../types';
  import { t } from '../i18n';
  import {
    setAiFlag,
    setStreamerFlair,
    STREAMER_LINK_MAX,
    type StreamerLinks,
    type StreamerPlatform,
  } from '../account_flair';
  import type { PendingAction } from '../moderation_actions';
  import Badge from './Badge.svelte';
  import ModerationActionPrompt from './ModerationActionPrompt.svelte';

  // Account flair: the AI mark and the official-streamer mark plus that streamer's
  // platform links. Not moderation: no reason is required, and a staff account may
  // legitimately be a streamer, so this renders for admin targets too (unlike the
  // punitive controls, which hide behind canModerate). The server re-authorizes and
  // re-validates every write; the URL checks here are operator UX only.
  type Target = Pick<AccountDetail, 'id' | 'isAi' | 'isStreamer' | 'streamerLinks'>;
  type SelectedAction = 'ai' | 'streamer' | 'links';

  let {
    target,
    onSubmit,
  }: {
    target: Target;
    onSubmit: (pending: PendingAction) => boolean | Promise<boolean>;
  } = $props();

  const FIELDS: { platform: StreamerPlatform; label: () => string }[] = [
    { platform: 'twitch', label: () => t('detail.streamerLinkTwitch') },
    { platform: 'x', label: () => t('detail.streamerLinkX') },
    { platform: 'kick', label: () => t('detail.streamerLinkKick') },
    { platform: 'youtube', label: () => t('detail.streamerLinkYoutube') },
  ];

  function formValues(links: StreamerLinks | undefined): Record<StreamerPlatform, string> {
    return {
      twitch: links?.twitch ?? '',
      x: links?.x ?? '',
      kick: links?.kick ?? '',
      youtube: links?.youtube ?? '',
    };
  }

  let selected = $state<SelectedAction | null>(null);
  // Seeded once from the prop (untrack: the $effect below owns re-seeding), so the
  // operator's in-progress edits survive an unrelated re-render.
  let form = $state(untrack(() => formValues(target.streamerLinks)));

  // Re-seed from the server's copy whenever the account (or its stored links) changes,
  // so a refreshed detail never leaves a stale value in the form.
  $effect(() => {
    target.id;
    selected = null;
    form = formValues(target.streamerLinks);
  });

  function titleFor(action: SelectedAction): string {
    if (action === 'ai') return target.isAi ? t('dialog.confirmUnmarkAi') : t('dialog.confirmMarkAi');
    if (action === 'links') return t('dialog.confirmStreamerLinks');
    return target.isStreamer
      ? t('dialog.confirmUnmarkStreamer')
      : t('dialog.confirmMarkStreamer');
  }

  function actionLabel(action: SelectedAction): string {
    if (action === 'ai') {
      return target.isAi ? t('dialog.actionUnmarkAi') : t('dialog.actionMarkAi');
    }
    if (action === 'links') return t('dialog.actionStreamerLinks');
    return target.isStreamer
      ? t('dialog.actionUnmarkStreamer')
      : t('dialog.actionMarkStreamer');
  }

  async function confirm(values: { reason: string }): Promise<void> {
    const action = selected;
    if (!action) return;
    const built =
      action === 'ai'
        ? setAiFlag(target.id, !target.isAi, values.reason)
        : setStreamerFlair(
            target.id,
            action === 'links' ? target.isStreamer : !target.isStreamer,
            form,
            values.reason,
          );
    if ('errorKey' in built) {
      window.alert(t(built.errorKey));
      return;
    }
    if (await onSubmit(built.pending)) selected = null;
  }
</script>

<section class="account-admin-controls flair-controls" aria-label={t('detail.accountFlair')}>
  <div class="account-status">
    <b>{t('detail.aiLabel')}</b>
    {#if target.isAi}
      <Badge variant="neutral" size="medium">{t('detail.aiMarked')}</Badge>
    {:else}
      <Badge size="medium">{t('detail.aiNotMarked')}</Badge>
    {/if}
    <button onclick={() => (selected = 'ai')}>
      {target.isAi ? t('detail.unmarkAi') : t('detail.markAi')}
    </button>
  </div>

  <div class="account-status">
    <b>{t('detail.streamerLabel')}</b>
    {#if target.isStreamer}
      <Badge variant="success" size="medium">{t('detail.streamerMarked')}</Badge>
    {:else}
      <Badge size="medium">{t('detail.streamerNotMarked')}</Badge>
    {/if}
    <button onclick={() => (selected = 'streamer')}>
      {target.isStreamer ? t('detail.unmarkStreamer') : t('detail.markStreamer')}
    </button>
  </div>

  <div class="streamer-links">
    <h4>{t('detail.streamerLinks')}</h4>
    <p class="hint">{t('detail.streamerLinksHint')}</p>
    <div class="link-fields">
      {#each FIELDS as field (field.platform)}
        <label>
          <span>{field.label()}</span>
          <input
            type="url"
            inputmode="url"
            autocomplete="off"
            maxlength={STREAMER_LINK_MAX}
            bind:value={form[field.platform]}
          />
        </label>
      {/each}
    </div>
    <button onclick={() => (selected = 'links')}>{t('detail.saveStreamerLinks')}</button>
  </div>
</section>

{#if selected}
  {@const action = selected}
  {#key `${target.id}:${action}`}
    <ModerationActionPrompt
      title={titleFor(action)}
      rows={[
        { label: t('dialog.account'), value: `#${target.id}` },
        { label: t('dialog.action'), value: actionLabel(action) },
      ]}
      reasonRequired={false}
      reasonPlaceholder={t('detail.flairNotePlaceholder')}
      onConfirm={confirm}
      onCancel={() => (selected = null)}
    />
  {/key}
{/if}

<style>
  .flair-controls {
    display: grid;
    gap: 8px;
    margin: 8px 0;
  }

  .account-status {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .streamer-links {
    padding: 8px;
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
  }

  h4 {
    margin: 0 0 4px;
  }

  .hint {
    margin: 0 0 8px;
    color: var(--text-dim);
    font-size: 12px;
  }

  .link-fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 8px;
  }

  label {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  label span {
    color: var(--text-dim);
    font-size: 12px;
  }

  @media (max-width: 760px) {
    .link-fields {
      grid-template-columns: 1fr;
    }
  }
</style>
