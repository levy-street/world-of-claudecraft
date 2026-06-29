<script lang="ts">
  import type { Snippet } from 'svelte';

  // Bordered gold-on-dark panel. With a title it renders the .panel-title bar (and an
  // optional muted hint on the right); without one it is a bare .panel. The `title`
  // snippet overrides the plain `title` string when the heading needs markup.
  let {
    title,
    hint,
    titleContent,
    children,
  }: {
    title?: string;
    hint?: string;
    titleContent?: Snippet;
    children: Snippet;
  } = $props();
</script>

<section class="panel">
  {#if titleContent || title}
    <div class="panel-title">
      {#if titleContent}{@render titleContent()}{:else}<span>{title}</span>{/if}
      {#if hint}<span class="hint">{hint}</span>{/if}
    </div>
  {/if}
  {@render children()}
</section>
