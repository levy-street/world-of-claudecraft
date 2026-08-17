<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { fmtNumber } from '../format';
  import {
    buildGeneralChatRateLimitRemoval,
    buildGeneralChatRateLimitUpdate,
    GENERAL_CHAT_RATE_LIMIT_MAX_MESSAGES,
    GENERAL_CHAT_RATE_LIMIT_MAX_WINDOW_MINUTES,
    GENERAL_CHAT_RATE_LIMIT_REASON_MAX_LENGTH,
    type GeneralChatRateLimitFormErrors,
  } from '../general_chat_rate_limit';
  import { t } from '../i18n';
  import type { PendingAction } from '../moderation_actions';
  import type { AccountDetail } from '../types';

  let {
    target,
    onSubmit,
  }: {
    target: Pick<AccountDetail, 'id' | 'generalChatRateLimit'>;
    onSubmit: (pending: PendingAction) => boolean | Promise<boolean>;
  } = $props();

  let mode = $state<'view' | 'edit' | 'remove'>('view');
  let messages = $state<number | undefined>(undefined);
  let windowMinutes = $state<number | undefined>(undefined);
  let reason = $state('');
  let errors = $state<GeneralChatRateLimitFormErrors>({});
  let submitting = $state(false);
  let submittedMode = $state<'edit' | 'remove' | null>(null);
  let editButton = $state<HTMLButtonElement>();
  let removeButton = $state<HTMLButtonElement>();
  let messagesInput = $state<HTMLInputElement>();
  let windowMinutesInput = $state<HTMLInputElement>();
  let reasonInput = $state<HTMLInputElement>();

  const idPrefix = $derived(`general-chat-rate-limit-${target.id}`);

  function formErrorText(key: string): string {
    return t(key, {
      min: fmtNumber(1),
      max:
        key === 'generalChatRateLimit.messagesError'
          ? fmtNumber(GENERAL_CHAT_RATE_LIMIT_MAX_MESSAGES)
          : key === 'generalChatRateLimit.windowMinutesError'
            ? fmtNumber(GENERAL_CHAT_RATE_LIMIT_MAX_WINDOW_MINUTES)
            : fmtNumber(GENERAL_CHAT_RATE_LIMIT_REASON_MAX_LENGTH),
    });
  }

  $effect(() => {
    target.id;
    target.generalChatRateLimit?.messages;
    target.generalChatRateLimit?.windowMinutes;
    const previousMode = untrack(() => mode);
    const previousSubmittedMode = untrack(() => submittedMode);
    mode = 'view';
    messages = undefined;
    windowMinutes = undefined;
    reason = '';
    errors = {};
    submitting = false;
    submittedMode = null;
    const restoreMode = previousMode !== 'view' ? previousMode : previousSubmittedMode;
    if (restoreMode) {
      void tick().then(() => {
        if (restoreMode === 'remove' && removeButton) removeButton.focus();
        else editButton?.focus();
      });
    }
  });

  async function beginEdit(): Promise<void> {
    messages = target.generalChatRateLimit?.messages;
    windowMinutes = target.generalChatRateLimit?.windowMinutes;
    reason = '';
    errors = {};
    mode = 'edit';
    await tick();
    messagesInput?.focus();
  }

  async function beginRemove(): Promise<void> {
    reason = '';
    errors = {};
    mode = 'remove';
    await tick();
    reasonInput?.focus();
  }

  async function returnToView(submitted: boolean): Promise<void> {
    const previousMode = mode;
    submittedMode = submitted && previousMode !== 'view' ? previousMode : null;
    mode = 'view';
    reason = '';
    errors = {};
    await tick();
    if (previousMode === 'remove') removeButton?.focus();
    else editButton?.focus();
  }

  async function cancel(): Promise<void> {
    await returnToView(false);
  }

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    const built = buildGeneralChatRateLimitUpdate(
      target.id,
      messages,
      windowMinutes,
      reason,
    );
    if ('errors' in built) {
      errors = built.errors;
      await tick();
      if (errors.messages) messagesInput?.focus();
      else if (errors.windowMinutes) windowMinutesInput?.focus();
      else reasonInput?.focus();
      return;
    }
    errors = {};
    submitting = true;
    try {
      if (await onSubmit(built.pending)) await returnToView(true);
    } finally {
      submitting = false;
    }
  }

  async function remove(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    const built = buildGeneralChatRateLimitRemoval(target.id, reason);
    if ('errors' in built) {
      errors = built.errors;
      await tick();
      reasonInput?.focus();
      return;
    }
    errors = {};
    submitting = true;
    try {
      if (await onSubmit(built.pending)) await returnToView(true);
    } finally {
      submitting = false;
    }
  }
</script>

<div class="general-chat-rate-limit" role="group" aria-labelledby={`${idPrefix}-title`}>
  <h4 id={`${idPrefix}-title`}>{t('generalChatRateLimit.title')}</h4>
  <p class="scope">{t('generalChatRateLimit.scope')}</p>

  {#if mode === 'view'}
    <p class="current-limit">
      {#if target.generalChatRateLimit}
        {t('generalChatRateLimit.current', {
          messages: fmtNumber(target.generalChatRateLimit.messages),
          minutes: fmtNumber(target.generalChatRateLimit.windowMinutes),
        })}
      {:else}
        <strong>{t('generalChatRateLimit.unlimited')}</strong>
      {/if}
    </p>
    <div class="rate-limit-actions">
      <button bind:this={editButton} type="button" onclick={beginEdit}
        >{t('generalChatRateLimit.edit')}</button
      >
      {#if target.generalChatRateLimit}
        <button bind:this={removeButton} type="button" onclick={beginRemove}
          >{t('generalChatRateLimit.remove')}</button
        >
      {/if}
    </div>
  {:else if mode === 'edit'}
    <form class="rate-limit-form" novalidate onsubmit={save}>
      <label>
        <span>{t('generalChatRateLimit.messagesLabel')}</span>
        <input
          type="number"
          min="1"
          max={GENERAL_CHAT_RATE_LIMIT_MAX_MESSAGES}
          step="1"
          inputmode="numeric"
          required
          bind:this={messagesInput}
          bind:value={messages}
          aria-invalid={errors.messages ? 'true' : undefined}
          aria-describedby={errors.messages ? `${idPrefix}-messages-error` : undefined}
        />
      </label>
      {#if errors.messages}
        <p id={`${idPrefix}-messages-error`} class="form-error" role="alert">
          {formErrorText(errors.messages)}
        </p>
      {/if}

      <label>
        <span>{t('generalChatRateLimit.windowMinutesLabel')}</span>
        <input
          type="number"
          min="1"
          max={GENERAL_CHAT_RATE_LIMIT_MAX_WINDOW_MINUTES}
          step="1"
          inputmode="numeric"
          required
          bind:this={windowMinutesInput}
          bind:value={windowMinutes}
          aria-invalid={errors.windowMinutes ? 'true' : undefined}
          aria-describedby={errors.windowMinutes ? `${idPrefix}-window-error` : undefined}
        />
      </label>
      {#if errors.windowMinutes}
        <p id={`${idPrefix}-window-error`} class="form-error" role="alert">
          {formErrorText(errors.windowMinutes)}
        </p>
      {/if}

      <label>
        <span>{t('dialog.reason')}</span>
        <input
          maxlength={GENERAL_CHAT_RATE_LIMIT_REASON_MAX_LENGTH}
          required
          bind:this={reasonInput}
          bind:value={reason}
          placeholder={t('generalChatRateLimit.reasonPlaceholder')}
          aria-invalid={errors.reason ? 'true' : undefined}
          aria-describedby={errors.reason ? `${idPrefix}-reason-error` : undefined}
        />
      </label>
      {#if errors.reason}
        <p id={`${idPrefix}-reason-error`} class="form-error" role="alert">
          {formErrorText(errors.reason)}
        </p>
      {/if}

      <div class="rate-limit-actions">
        <button type="submit" disabled={submitting}>{t('generalChatRateLimit.save')}</button>
        <button type="button" disabled={submitting} onclick={cancel}>{t('dialog.cancel')}</button>
      </div>
    </form>
  {:else}
    <form class="rate-limit-form" novalidate onsubmit={remove}>
      <p>{t('generalChatRateLimit.removeHint')}</p>
      <label>
        <span>{t('dialog.reason')}</span>
        <input
          maxlength={GENERAL_CHAT_RATE_LIMIT_REASON_MAX_LENGTH}
          required
          bind:this={reasonInput}
          bind:value={reason}
          placeholder={t('generalChatRateLimit.reasonPlaceholder')}
          aria-invalid={errors.reason ? 'true' : undefined}
          aria-describedby={errors.reason ? `${idPrefix}-reason-error` : undefined}
        />
      </label>
      {#if errors.reason}
        <p id={`${idPrefix}-reason-error`} class="form-error" role="alert">
          {formErrorText(errors.reason)}
        </p>
      {/if}
      <div class="rate-limit-actions">
        <button type="submit" disabled={submitting}>
          {t('generalChatRateLimit.confirmRemove')}
        </button>
        <button type="button" disabled={submitting} onclick={cancel}>{t('dialog.cancel')}</button>
      </div>
    </form>
  {/if}
</div>

<style>
  .general-chat-rate-limit {
    display: grid;
    gap: 6px;
    width: 100%;
    margin-top: 8px;
    padding-top: 10px;
    border-top: 1px solid var(--border-subtle);
  }

  h4,
  p {
    margin: 0;
  }

  .scope,
  .current-limit {
    color: var(--text-dim);
  }

  .rate-limit-form,
  .rate-limit-form label {
    display: grid;
    gap: 5px;
  }

  .rate-limit-form {
    max-width: 440px;
  }

  .rate-limit-form input {
    width: 100%;
    box-sizing: border-box;
  }

  .form-error {
    color: var(--color-danger);
    font-size: 12px;
  }

  .rate-limit-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
</style>
