# Druid cat authoring

Blender 5.1 authoring only, not a client or build dependency. The user-provided
unrigged `Druid_Cat_form` mesh is the source. Preserve its geometry, UVs and texture.
`rig.py` fits Blender Rigify's quadruped metarig. Animations must be in place:
the simulation owns translation and the jump arc. Export a baked deformation
skeleton, never the Rigify controls and mechanism bones. Keep the editable rig
and source actions in the saved Blender file.

Use the parent `scripts/assets/CLAUDE.md` character optimizer and final KTX2 step.
Validate planted paws, loop closure, skin weights and a re-imported GLB before
accepting the asset; in-game playback is also required.
