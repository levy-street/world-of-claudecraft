# Groups visual review

Current screenshots use the shipping `DungeonFinderWindow` and CSS in an isolated
headless Chromium page with fixture players and listings. They do not attach to a
user's game, create accounts, or test multiplayer delivery.

Reproduce with Vite running:

```sh
GAME_URL=http://127.0.0.1:5264 OUT=docs/screenshots/dungeon-groups node scripts/dungeon_expeditions_shot.mjs
```

Desktop is 1440 x 1000; mobile is 390 x 844 with the game's `mobile-touch` class.
The script uses the game's Google Fonts stylesheet and waits for fonts and images.

| Surface | Desktop | Mobile |
| --- | --- | --- |
| Browse groups | [Current](after-desktop-groups.png) | [Current](after-mobile-groups.png) |
| Create group | [Current](after-desktop-create.png) | [Current](after-mobile-create.png) |
| Members and applications | [Current](after-desktop-members.png) | [Current](after-mobile-members.png) |
| Earlier intermediate Groups design | [Earlier](before-intermediate-desktop.png) | [Earlier](before-intermediate-mobile.png) |

The before images preserve the earlier feature preview from `tmp/groups-preview`.
They show an intermediate design, **not the release branch baseline**. The fixtures
and visible listing composition differ; compare layout and presentation, not game
state. A comparable pre-feature release capture was not available in this session.
