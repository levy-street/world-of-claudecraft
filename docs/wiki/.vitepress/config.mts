import { defineConfig } from 'vitepress'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'

// World of Claudecraft — public dev wiki.
// Source of truth is the markdown in docs/wiki/*.md; this just renders it as a
// focused docs site (served at /dev). Deliberately isolated from the game build.
export default defineConfig({
  title: 'World of Claudecraft — Dev',
  description: 'Public development wiki: vision, roadmap, design lens, and system designs.',
  base: '/dev/',
  cleanUrls: true,
  lastUpdated: true,
  // We link out to repo files (../README.md, ../prd/…) that aren't part of this site.
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: 'Roadmap', link: '/roadmap' },
      { text: 'System Designs', link: '/system-designs/' },
      { text: 'Play', link: 'https://worldofclaudecraft.com' },
    ],
    sidebar: [
      {
        text: 'Overview',
        items: [
          { text: 'Home', link: '/' },
          { text: 'Vision', link: '/vision' },
          { text: 'Current State', link: '/current-state' },
          { text: 'Design Influences', link: '/design-influences' },
          { text: 'Design Lens', link: '/design-lens' },
          { text: 'Roadmap', link: '/roadmap' },
        ],
      },
      {
        text: 'System Designs',
        items: [
          { text: 'Backlog (TODO hub)', link: '/system-designs/' },
          { text: 'Professions', link: '/system-designs/professions' },
          { text: 'Equipment Slots', link: '/system-designs/equipment-slots' },
        ],
      },
    ],
    search: { provider: 'local' },
    outline: { level: 'deep', label: 'On this page' },
    docFooter: { prev: true, next: true },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/levy-street/world-of-claudecraft' },
    ],
    editLink: {
      pattern: 'https://github.com/levy-street/world-of-claudecraft/edit/main/docs/wiki/:path',
      text: 'Edit this page on GitHub',
    },
    lastUpdatedText: 'Updated',
  },

  // Agent affordances: copy the raw source markdown of each page into the build
  // (served at /dev/raw/<path>.md) and emit llms.txt / llms-full.txt bundles.
  buildEnd(siteConfig) {
    const { srcDir, outDir } = siteConfig
    const pages: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === '.vitepress' || name === 'node_modules' || name.startsWith('.')) continue
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (name.endsWith('.md')) pages.push(full)
      }
    }
    walk(srcDir)
    pages.sort()

    let llms = '# World of Claudecraft — Dev Wiki\n\n'
    llms += '> Public development wiki (vision, roadmap, system designs). '
    llms += 'Each page\'s raw markdown is linked below; llms-full.txt has everything inline.\n\n'
    let full = ''
    for (const p of pages) {
      const rel = relative(srcDir, p).split('\\').join('/')
      const md = readFileSync(p, 'utf8')
      const dest = join(outDir, 'raw', rel)
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, md)
      llms += `- [${rel}](/dev/raw/${rel})\n`
      full += `\n\n<!-- ===== ${rel} ===== -->\n\n${md}`
    }
    writeFileSync(join(outDir, 'llms.txt'), llms)
    writeFileSync(join(outDir, 'llms-full.txt'), full.trim() + '\n')
  },
})
