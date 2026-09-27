# Website redesign integration

The player website redesign is based on `origin/release/v0.43.3` at
`f8287063e0e78e32a3f1dfe6926bbe47f70a0b01`. It retains that release's
initial `start-screen-open` state and new locale entries. Resolved locale
artifacts were regenerated using `npm run i18n:gen`.

The companion designs are separate changes in Records, Scout, and Parse Service.
Their shared chrome remains canonical in the Parse Service repository and is
copied verbatim to the two Python companion sites. No game city, simulation,
balance, database, or server authentication changes are part of this redesign.

## Review evidence

Before/after desktop (1440x1000) and phone (390x844) screenshots are committed
under `docs/screenshots/website-redesign`. The before screenshots use the exact
release base. The after screenshots use this branch. The login page scrolls
within its existing start-screen container, so screenshots show the initial
viewport. A separate phone login screenshot shows the authentication form.

Browser checks covered the phone menu, login/register toggle, password recovery,
320px layout, landscape, forced colors, and reduced motion. The website video
has no source attached; the hero uses the approved location illustrations.
Navigation and authentication controls retain their existing IDs and handlers.
The local preview does not run the game backend, so live account authentication
and population counts were not exercised. No real credentials were submitted.

The read-only frontend review identified safe-area padding lost in the new
responsive rules. Header, content, and footer padding now retain phone notch
and home-indicator insets. Test review confirmed navigation assertions and
CSS guards are preserved. Final gate results are recorded in the PR.
