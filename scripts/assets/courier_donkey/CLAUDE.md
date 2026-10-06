# Courier donkey

Original stylized flying donkey, authored from the feature description with no
third-party reference. `model.js` owns the compact body, long ears, pale muzzle,
short mane, leather panniers and independently articulated feather wings.
`export_entry.js` exports the named pivots; `export_courier_donkey.mjs` runs the
shared asset optimizer. All colour is baked into vertices, with no texture cost.
Regenerate the shipping GLB after editing any source here, then run the scoped
texture compressor and the media manifest generator. Runtime animation belongs
to `src/render/courier_visual_core.ts`, not the authoring factory.
