# Phone launcher: select at shoulder height, one-time pinch hint

The dev client on the phone interface (headless Edge as an Android phone, 932 by 430
landscape and 430 by 932 portrait, lowest graphics preset), with the REST API mocked in
the page: a restored session, one realm and a one-character roster (a level 20 warrior),
so the online character select and creator load without a game server. BEFORE is
`feature/v045-integration` as it was; AFTER is this branch.

- `compare.png`: the before and after pairs on one sheet.
- `before-1-select.png`, `after-1-select.png`: character select. The roster's pick used
  to open on the whole body, small in the middle of the stage; it now opens on the same
  head-and-shoulders shot as the creator, and a pinch still zooms out to the whole body.
- `before-2-create.png`, `after-2-create.png`, `after-2b-create-stage.png` (the stage
  close up): the online creator. A slim "Pinch to zoom" tab is docked to the stage's
  left edge, beside the model and never over it. It slides out a beat after the model
  draws, with two fingertips spreading apart on a loop (still, in the spread pose, under
  reduced motion).
- `after-3-create-after-pinch.png`: the first pinch zooms the camera in and the tab
  slides back into the stage edge for good.
- `after-4-create-revisit.png`: after a reload, the creator again: the tab stays gone
  (the first gesture is stored on the device).
- `after-portrait-1-select.png`, `after-portrait-2-create.png`: the same two screens in
  portrait.
