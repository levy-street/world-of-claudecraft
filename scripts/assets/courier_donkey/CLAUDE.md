# Courier donkey

The user supplied `winged_mail_donkey.glb` on 2026-10-07. Its untouched donor is
retained under `source/`; do not replace it with the previous procedural donkey.
The donor has one skinned mesh, 47 joints, Idle/Run/Fly clips, and a 1024px PNG.
Its SHA-256 is pinned by the importer and parsed asset test. Authorship and license
were not supplied; do not describe it as project-authored or CC0.

Regenerate with `node scripts/assets/courier_donkey/export_courier_donkey.mjs`.
This runs the character-safe meshopt optimizer, mandatory KTX2 texture compression,
and media manifest generation. Set `KTX_BIN` to Khronos KTX-Software's bin directory
when it is not on PATH. Source texture dimensions remain 1024px.

Runtime uses cloned skeletons and animation clips, preserves compressed materials,
removes Fly's constant root hover channel, and owns terrain-relative altitude.
The grounded Idle pose is normalized to 1.27575 world units, the horse buddy height
in PR #4240 (0.75 base height times 1.701). Never dispose loader-owned resources.
