# Face builder: share a face as a code

The dev client with the REST API mocked in the page (a restored session, one realm and a
one-character roster), so the online creator and character select load without a game
server. Desktop is headless Chrome at 1440 by 900; phone is the same browser as an Android
phone, 430 by 932 portrait, on the touch interface. BEFORE is `feature/v045-integration` as
it was; AFTER is this branch.

- `compare-desktop.png`: the desktop pairs on one sheet. The creator before (no way to save
  or send a face) and after (a gold Share button under Random and Reset to Default), the
  Share page and Copy, a face loaded from a code, and the character select Redesign editor,
  which mounts the same builder, before and after.
- `compare-phone.png`: the phone's face builder before and after, the Share page, and a
  pasted code imported. The tab strip scrolls on a phone, so the footer button is the one
  way to Share every layout shows.
- `after-desktop-2-share.png`: Share pressed. The panel beside the menu shows the face as a
  code, with Copy code and Import under it, and the camera turns to the face.
- `after-desktop-3-copied.png`: Copy code put the code on the clipboard.
- `after-desktop-5-imported.png`: after Reset to Default put another face on the stage, the
  first face's code was pasted back the way a Discord message hands it over (behind a
  label, in backticks) and imported: the first face is back, and the box holds its clean
  code.
- `after-desktop-6-bad-code.png`: a paste that is not a code says so and changes nothing.
- `after-desktop-7-redesign.png`: the Redesign editor's Share page, Copy and Import
  stacked in its narrower panel.
- `after-phone-2-share.png`: the Share page on a phone, above the gold Share bar.
