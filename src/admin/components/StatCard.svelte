<script lang="ts">
  // One overview stat: a large gold value over a small uppercased label. Matches the
  // old statCard() (.panel.stat). The grid layout comes from #stats in admin.css.
  let { value, label }: { value: string; label: string } = $props();
</script>

<div class="panel stat">
  <div class="v">{value}</div>
  <div class="k">{label}</div>
</div>
