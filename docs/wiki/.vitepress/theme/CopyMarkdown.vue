<script setup lang="ts">
import { useData, withBase } from 'vitepress'
import { ref, computed } from 'vue'

const { page } = useData()
const rawHref = computed(() => withBase('/raw/' + page.value.relativePath))
const state = ref<'idle' | 'ok' | 'err'>('idle')

async function copy() {
  try {
    const md = await (await fetch(rawHref.value)).text()
    await navigator.clipboard.writeText(md)
    state.value = 'ok'
  } catch {
    state.value = 'err'
  }
  setTimeout(() => (state.value = 'idle'), 1600)
}

const label = computed(() =>
  state.value === 'ok' ? '✓ Copied' : state.value === 'err' ? '✗ Copy failed' : 'Copy as Markdown',
)
</script>

<template>
  <div class="copy-md">
    <button type="button" @click="copy" title="Copy this page's raw Markdown for agents / LLMs">
      {{ label }}
    </button>
    <a :href="rawHref" target="_blank" rel="noopener">View raw .md</a>
    <a :href="withBase('/llms.txt')" target="_blank" rel="noopener" class="dim">llms.txt</a>
  </div>
</template>

<style scoped>
.copy-md {
  display: flex;
  gap: 0.85rem;
  align-items: center;
  margin: -0.5rem 0 1.25rem;
  font-size: 0.8rem;
}
.copy-md button {
  padding: 0.3rem 0.7rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}
.copy-md button:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-bg-elv);
}
.copy-md a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}
.copy-md a:hover {
  text-decoration: underline;
}
.copy-md a.dim {
  color: var(--vp-c-text-3);
}
</style>
