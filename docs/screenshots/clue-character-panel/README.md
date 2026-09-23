# Character C panel finish for world quests

This is the visual follow-up to the Character C panel introduced on
`feature/world-quests`. The character sheet keeps its existing Character,
Reputation, Currencies, Progression, and Professions tabs. The stat rail now
has room for the current specialization and class under Defense. Equipment,
footer, profession cards, and the Cosmetics dialog have larger, aligned
controls. The catalog already supplies the cosmetic artwork used here.

The panel change is independent of the trinket equipment proposal. Its
paperdoll has the existing twelve equipment sockets.

## Captures

Before, on the world-quests panel before this finish:

- [Character desktop](../wq-reputation-ui/after-char-sheet-spec-desktop.png)
- [Character mobile](../wq-reputation-ui/after-char-sheet-spec-mobile.png)
- [Professions](before-professions.png)
- [Cosmetics](before-cosmetics.png)

After, on the world-quests panel updated to `release/v0.44.0`:

- [Character desktop](after-desktop.png), [phone portrait](after-portrait.png),
  [phone portrait footer](after-portrait-footer.png),
  [phone landscape](after-landscape.png), and
  [phone landscape footer](after-landscape-footer.png)
- [Professions desktop](after-professions.png),
  [phone portrait](after-professions-portrait.png), and
  [phone landscape](after-professions-landscape.png)
- [Cosmetics desktop](after-cosmetics.png),
  [phone portrait](after-cosmetics-portrait.png), and
  [phone landscape](after-cosmetics-landscape.png)

The captures use the offline game and Chromium. Mobile captures expose the
touch layout beneath the rotation prompt so the controls can be inspected.
The browser tests additionally populate the profession and cosmetics data.
