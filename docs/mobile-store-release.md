# Mobile Store Release

World of ClaudeCraft ships to iOS and Android through Capacitor. The native apps
bundle the built Vite client and connect to the production backend at
`https://worldofclaudecraft.com`.

## Prerequisites

- Xcode for iOS archives.
- Android Studio plus JDK 21 for Capacitor 8 Android builds.
- Existing Apple and Google organization developer accounts.
- Cloudflare Turnstile must allow the native WebView origins used by Capacitor:
  `capacitor://localhost` for iOS and `http://localhost` for Android.

## Versioning

The app version lives in three files that must stay in lockstep:

| File | Field(s) |
|---|---|
| `package.json` | `version` |
| `android/app/build.gradle` | `versionName`, `versionCode` |
| `ios/App/App.xcodeproj/project.pbxproj` | `MARKETING_VERSION`, `CURRENT_PROJECT_VERSION` |

Do not edit these by hand. Bump them all in one step with npm's built-in
`version` command, which fires the `version` lifecycle hook
(`scripts/version_sync.mjs`) and folds the native files into the same commit and
tag:

```sh
npm version 0.15.0        # exact version
npm version minor         # or patch / major
```

This sets the marketing version (`version` / `versionName` / `MARKETING_VERSION`)
to the new semver across all three files and increments the native build numbers
(`versionCode` / `CURRENT_PROJECT_VERSION`), which the App Store and Play Store
require to strictly increase on every upload.

To resync the native manifests to the current `package.json` version without
cutting a release commit (e.g. after a manual edit), run:

```sh
npm run version:sync
```

## Commands

```sh
npm run native:sync
npm run native:open:ios
npm run native:open:android
```

`native:sync` runs a native build of the web app with:

```sh
VITE_NATIVE_APP=1
VITE_API_ORIGIN=https://worldofclaudecraft.com
```

The copied web assets under the native projects are generated and ignored by git.
Run `npm run native:sync` before opening Xcode or Android Studio for a release
archive.

For local testing on a physical phone, point the native build at the server
running on the development machine's LAN IP:

```sh
VITE_API_ORIGIN=http://192.168.1.247 npm run native:sync
```

Replace the IP with the Mac's current Wi-Fi/LAN address. Do not use
`localhost` for a physical phone; that resolves to the phone itself.

## Over The Air Updates

The native apps include the Ionic Appflow Capacitor Live Updates SDK. It is
configured in `capacitor.config.ts` with:

| Setting | Value |
|---|---|
| Appflow app ID | `9fa1b0c1` |
| Channel | `Production` |
| Update method | `background` |

Background updates are downloaded after app launch and become active on the next
launch. Use this for web asset fixes only: HTML, CSS, JavaScript, bundled media,
copy, and other client code already inside the Capacitor web build. Changes to
native code, app icons, splash screens, permissions, entitlements, Capacitor
config, or native plugin versions still require a new App Store or Play Store
binary.

After changing the Live Updates config or native dependencies, run:

```sh
npm run native:sync
```

To ship an OTA update after the app-store binary containing Live Updates has
been approved:

1. Build the web app in Appflow from the target Git commit.
2. Assign the web build to the `Production` Live Update channel.
3. Test on a store or TestFlight build by launching once to download the update,
   then closing and relaunching the app to apply it.

## Store Review Notes

- App name: World of ClaudeCraft.
- Bundle/application ID: `com.worldofclaudecraft`.
- App Store tags: Action, Fantasy, Free, Co-Op, PvP, Leaderboard, MMO,
  Multiplayer, Open World.
- The iOS asset catalog includes Light, Dark, and Tinted app icon variants. The
  newer Clear appearance is an Icon Composer workflow, not a PNG appiconset slot;
  create and add a matching `AppIcon.icon` asset in Xcode when adopting Apple's
  Liquid Glass icon format.
- First store release hides Donate, GitHub Sponsors, and token contract CTAs in
  native builds.
- Online play uses the hosted production REST and WebSocket backend.
- Privacy and terms URLs:
  - `https://worldofclaudecraft.com/privacy.html`
  - `https://worldofclaudecraft.com/terms.html`
