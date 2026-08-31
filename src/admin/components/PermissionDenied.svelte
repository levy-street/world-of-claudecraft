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
  import { t } from '../i18n';
</script>

<div class="permission-denied" role="status">
  <strong>{t('loadFailure.forbiddenTitle')}</strong>
  <span>{t('loadFailure.forbiddenDetail')}</span>
</div>

<style>
  /* Deliberately NOT the `.empty` italic-dim treatment the generic arm uses:
     the whole point is that an operator can tell the two apart at a glance. */
  .permission-denied {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 14px 12px;
    color: var(--text);
    background: var(--surface-sunken);
    border-left: 3px solid var(--badge-warn-text);
    border-radius: 2px;
  }

  .permission-denied strong {
    color: var(--badge-warn-text);
  }

  .permission-denied span {
    color: var(--text-soft);
    line-height: 1.5;
  }
</style>
