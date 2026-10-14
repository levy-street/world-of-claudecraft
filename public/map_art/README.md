# Static painted maps

The map editor loads these files directly. There is no runtime image-generation request.

- `world.png` is the full-world plate.
- `<zone-id>.png` is a zone plate.
- `public/map_bg/<zone-id>.webp` is the exact technical reference for repainting a zone.
- `public/map_bg/world_strip.webp` is the compact technical world reference.

To update a plate manually, generate or paint a replacement PNG, keep north at the top, preserve the reference coastline, water, roads, and major landforms, then replace the matching file and reload the editor. Keep labels, icons, UI frames, and player markers out of the artwork because the application draws them live.
