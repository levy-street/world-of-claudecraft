# Classic human autoattack inputs

Blizzard-authored human models from Classic Era 1.15.9.70003, decoded with
https://github.com/Kruithne/wow.export at c2fd7bde36a712be78a5da896c995b84fbfa2545.
Male fileDataID 119940; female fileDataID 119563. File names were resolved using
https://github.com/wowdev/wow-listfile/releases/tag/202610082053.

The manifest records the original M2 hashes, build keys and extracted GLB hashes.
The GLBs contain only bones and 15 attack sequences each. Bind JSON files retain
the corresponding M2 parent hierarchy, pivot positions and key-bone IDs. M2Loader
converted axes to Y-up. Extraction preserved durations and keys, normalized packed
quaternions and rejected aliases, external tracks and unsupported interpolation.
These GLBs are offline build inputs, never delivered as player meshes.
