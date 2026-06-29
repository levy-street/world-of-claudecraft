<script lang="ts">
  // Full-screen click-to-dismiss overlay for a bug-report screenshot. Closes on click
  // or Escape (ported from the old showBugScreenshot overlay). The image src is a
  // server-provided data URL fetched on demand.
  let { src, alt, onClose }: { src: string; alt: string; onClose: () => void } = $props();

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="bug-shot-overlay" role="presentation" onclick={onClose}>
  <img {src} {alt} />
</div>
