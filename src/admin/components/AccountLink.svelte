<script lang="ts">
  import { getAccountModalController } from '../account_modal';

  let {
    accountId,
    label,
    onChanged,
  }: {
    accountId: number;
    label: string;
    onChanged?: () => void;
  } = $props();
  const accountModal = getAccountModalController();

  function open(event: MouseEvent): void {
    event.stopPropagation();
    accountModal?.open(accountId, onChanged);
  }
</script>

<button class="btn-link" type="button" aria-haspopup="dialog" onclick={open}>
  {label}
</button>
