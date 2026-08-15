<script lang="ts">
  // The watchlist star, drawn as an inline SVG (the CollapsiblePanel caret idiom)
  // rather than a glyph: the house copy rule bans emoji anywhere, and a star
  // character is decoration that carries no text of its own. It is aria-hidden,
  // so the accessible name comes entirely from the t() label on the button that
  // owns it. `filled` distinguishes a watched row from an unwatched one, and
  // currentColor lets the owning button's .watched color do the highlighting.
  let { filled = false }: { filled?: boolean } = $props();
</script>

<svg class="watch-star" viewBox="0 0 16 16" aria-hidden="true">
  <path
    d="M8 1.6l1.9 4 4.4.6-3.2 3.1.8 4.4L8 11.6l-3.9 2.1.8-4.4L1.7 6.2l4.4-.6z"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    stroke-width="1.3"
    stroke-linejoin="round"
  />
</svg>

<style>
  .watch-star {
    width: 1em;
    height: 1em;
    vertical-align: -0.125em;
  }
</style>
