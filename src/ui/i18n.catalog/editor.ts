// i18n source catalog - the map editor surface at /editor. English values only;
// the locale translations live in src/ui/i18n.locales/<lang>.ts (the
// runtime-authoritative overlays), filled by the maintainer at release (the five
// non-Latin locales are filled in the same change per the M16 gate).
//
// Assembled into `en` by ./index.ts under the `editor` namespace. Like guide.ts
// and hud_chrome.ts this module carries NO per-locale blocks (no `as const`), so
// a new editor string is an English-only add that compiles; the translations
// live solely in the overlays.

export const editorStrings = {
  appTitle: 'Map Editor',
  // Browser tab title. Hyphen separator (not a dash character).
  docTitle: 'Map Editor - World of ClaudeCraft',
  untitledMap: 'Untitled Map',
  // The offline character name a playtest boots with.
  playtestPlayerName: 'Mapmaker',

  topbar: {
    label: 'Editor actions',
    mapNameLabel: 'Map name',
    dirty: 'Unsaved changes',
    dirtyDot: 'This map has unsaved changes',
    clean: 'All changes saved',
    savedLocal: 'Saved in this browser',
    savedServer: 'Saved to server (v{version})',
    saving: 'Saving...',
    neverSaved: 'Not saved yet',
    new: 'New',
    newTitle: 'Start a new map from the built-in world',
    open: 'Open',
    openTitle: 'Open a saved map (browser or server)',
    save: 'Save',
    saveTitle: 'Save to this browser, and to the server when signed in (Ctrl+S)',
    saveAs: 'Save As',
    saveAsTitle: 'Save a copy under a new name',
    fork: 'Fork',
    forkTitle: 'Create your own server-side copy of this map',
    forkDisabledTitle: 'Open a server map first to fork it',
    import: 'Import',
    importTitle: 'Import a map from a JSON file',
    export: 'Export',
    exportTitle: 'Download this map as a JSON file',
    uploadAsset: 'Upload Asset',
    uploadAssetTitle: 'Upload a GLB model (up to 8 MiB) to place in your maps',
    uploadAssetDisabledTitle: 'Sign in from the game to upload assets',
    playtest: 'Playtest',
    playtestTitle: 'Boot the game on this map (offline, current edits included)',
    viewLabel: 'View mode',
    view3d: '3D',
    view3dTitle: 'Edit in the rendered world',
    view2d: '2D',
    view2dTitle: 'Edit on the symbolic overhead map',
    undoCount: 'Undo: {count}',
    undoCountTitle: '{count} undoable steps (Ctrl+Z to undo, Ctrl+Y to redo)',
    autosave: 'Autosave',
    autosaveTitle:
      'Automatically save the map while there are unsaved changes. Turns itself off if a save fails.',
    undo: 'Undo',
    undoTitle: 'Undo the last change (Ctrl+Z)',
    redo: 'Redo',
    redoTitle: 'Redo the last undone change (Ctrl+Y)',
    offline: 'Offline',
    offlineTitle:
      'Not signed in: maps save to this browser only. Sign in from the game to save online.',
    signIn: 'Sign in',
    signInTitle: 'Open the game login screen in a new tab',
    help: 'Help',
    helpTitle: 'Editor guide: tools, shortcuts, and the tutorial',
  },

  tool: {
    listLabel: 'Editor tools',
    keyHint: '{name} ({key})',
    select: 'Select',
    raise: 'Raise',
    lower: 'Lower',
    smooth: 'Smooth',
    flatten: 'Flatten',
    paint: 'Paint Biome',
    water: 'Water',
    place: 'Place Asset',
    blocker: 'Blocker Wall',
    camp: 'Camp',
    spawn: 'Spawn Point',
    region: 'Region',
    erase: 'Erase',
  },

  inspector: {
    label: 'Tool options',
  },

  brush: {
    title: 'Brush',
    size: 'Brush size',
    strength: 'Strength',
    sizeHint: 'Keys: [ and ] resize the brush; Shift+[ and Shift+] change strength.',
    editCount: 'Terrain edits: {count} / {max}',
  },

  biome: {
    title: 'Biome',
    paletteLabel: 'Biome to paint',
    vale: 'Vale',
    marsh: 'Marsh',
    peaks: 'Peaks',
    beach: 'Beach',
    desert: 'Desert',
    volcano: 'Volcano',
    cave: 'Cave',
    erase: 'Erase paint',
    hint: 'Painted cells override the zone biome for terrain shape and color.',
    clear: 'Clear all biome paint',
    clearConfirm: 'Remove every painted biome cell from this map?',
  },

  flatten: {
    hint: 'Flatten levels the ground to the height under the cursor when the drag starts.',
    hardEdge: 'Hard edge',
  },

  water: {
    title: 'Water Level',
    level: 'Water level',
    hint: 'Sets the map-wide water surface height, from {min} to {max} yards.',
    reset: 'Reset to the built-in level',
  },

  place: {
    title: 'Place Asset',
    scale: 'Scale',
    collide: 'Blocks movement',
    collideHint: 'A blocking asset gets a collision footprint players cannot walk through.',
    randomRotation: 'Random rotation',
    chosen: 'Placing: {name}',
    none: 'Pick an asset from the browser below, then click the ground to place it.',
  },

  blockerTool: {
    title: 'Blocker Wall',
    hint: 'Drag along the ground to draw an invisible wall players cannot walk or jump through. Release to place it; a wall shorter than half a yard is discarded.',
    count: 'Blocker walls: {count} / {max}',
  },

  camp: {
    title: 'Mob Camp',
    mob: 'Mob',
    count: 'Count',
    radius: 'Radius',
    delete: 'Delete camp',
    hint: 'Click open ground to add a camp, or click an existing camp to edit it.',
    playtestNote: 'Mobs spawn only in playtest, never in the editor view.',
    selected: 'Camp: {mob}',
    none: 'No camp selected.',
  },

  spawn: {
    title: 'Spawn Point',
    hint: 'Click the ground to set where playtest drops the player.',
    position: 'Spawn: {x}, {z}',
    unset: 'Using the built-in start position.',
    clear: 'Clear spawn point',
  },

  region: {
    title: 'Region',
    hint: 'Drag a box to select placements and terrain edits. Copy, then click to paste.',
    hint3d: 'Region boxes draw in the 2D view; copy and paste work in both views.',
    copy: 'Copy region',
    pasteBeside: 'Paste beside',
    copied: 'Copied {assets} assets and {edits} terrain edits.',
    pasted: 'Pasted {count} items.',
    needBox: 'Draw a region box first.',
    needClipboard: 'Copy a region first.',
  },

  eraseTool: {
    title: 'Erase',
    hint: 'Click a placed asset to remove it, or click sculpted ground to remove the newest stamp under the cursor.',
    blockerHint: 'Clicking near a blocker wall removes that wall instead.',
  },

  selection: {
    title: 'Selection',
    none: 'Nothing selected. Use Select and click a placed asset.',
    asset: 'Asset: {name}',
    x: 'X',
    z: 'Z',
    rotation: 'Rotation',
    scale: 'Scale',
    collide: 'Blocks movement',
    radius: 'Collision radius',
    radiusAuto: 'Auto',
    radiusAutoTitle: 'Reset the collision radius to follow the asset scale',
    radiusHint:
      'Auto derives the collision radius from the asset scale; drag the slider to override it.',
    footprints: 'Show collision footprints',
    duplicate: 'Duplicate',
    delete: 'Delete',
    deleteHint: 'Delete removes the selection; Ctrl+Z restores it.',
    moveHint:
      'Move: drag the asset along the ground in the 3D view, or nudge it with the arrow keys (0.5 yd, Shift for 2 yd).',
    wheelHint: 'Shift+scroll rotates the asset, Alt+scroll scales it, Ctrl+D duplicates it.',
  },

  marker: {
    title: 'Marker',
    reset: 'Reset position',
    moved: '{count} markers moved from the built-in layout.',
  },

  layers: {
    title: 'Layers',
    hub: 'Hubs',
    graveyard: 'Graveyards',
    lake: 'Lakes',
    poi: 'Points of interest',
    camp: 'Camps',
    npc: 'NPCs',
    object: 'Objects',
    blocker: 'Blocker walls',
  },

  frame: {
    title: 'Frame',
    all: 'All',
  },

  procgen: {
    title: 'Procedural',
    count: 'Count',
    scatter: 'Scatter category assets',
    hills: 'Generate rolling hills',
    scattered: 'Scattered {count} assets from {category}.',
    hillsAdded: 'Added {count} hills.',
    noAssets: 'No assets in that category.',
  },

  assets: {
    title: 'Asset Browser',
    label: 'Asset browser',
    search: 'Search assets',
    searchPlaceholder: 'Search assets...',
    empty: 'No matching assets.',
    uploadedTab: 'Uploaded',
    uploadedEmpty: 'No uploaded assets yet. Use Upload Asset to add a GLB model (up to 8 MiB).',
    uploadedSignIn: 'Sign in from the game to upload and place your own GLB models.',
    uploadedLoadFailed: 'Could not load your uploaded assets.',
    deleteAsset: 'Delete uploaded asset',
    deleteAssetConfirm: 'Delete the uploaded asset "{name}"? Maps that use it lose the model.',
    pick: 'Place {name}',
    categoryTab: '{category} ({count})',
    category: {
      biome: 'Biome',
      chars: 'Characters',
      creatures: 'Creatures',
      dungeon: 'Dungeon',
      foliage: 'Foliage',
      props: 'Props',
      quest: 'Quest',
      resources: 'Resources',
      tools: 'Tools',
      weapons: 'Weapons',
    },
  },

  upload: {
    notGlb: 'Pick a .glb file.',
    tooLarge: 'That file is over the 8 MiB limit.',
    uploading: 'Uploading asset...',
    uploaded: 'Asset uploaded: {name}',
    uploadedExisting: 'That model was already on the server; reusing it.',
    deleted: 'Uploaded asset deleted.',
  },

  openDrawer: {
    title: 'Open Map',
    close: 'Close',
    tabLocal: 'This Browser',
    tabMine: 'My Server Maps',
    tabPublic: 'Public Maps',
    colName: 'Name',
    colUpdated: 'Updated',
    colStatus: 'Status',
    statusPublic: 'Public',
    statusPrivate: 'Private',
    open: 'Open',
    fork: 'Fork',
    publish: 'Publish',
    unpublish: 'Unpublish',
    delete: 'Delete',
    draft: 'Autosaved draft',
    emptyLocal: 'No maps saved in this browser yet. Save one and it appears here.',
    emptyMine: 'No maps on the server yet. Save while signed in to create one.',
    emptyPublic: 'No public maps yet.',
    loading: 'Loading maps...',
    loadFailed: 'Could not load maps from the server.',
    signInHint: 'Sign in from the game to browse, save, and fork server maps.',
    deleteLocalConfirm: 'Delete the local map "{name}"?',
    deleteServerConfirm: 'Delete the server map "{name}"? This cannot be undone.',
    prev: 'Previous page',
    next: 'Next page',
    page: 'Page {page}',
  },

  status: {
    savedLocal: 'Saved "{name}" to this browser.',
    savedServer: 'Saved "{name}" to the server (v{version}).',
    savedLocalOnly: 'Saved "{name}" to this browser. Sign in to save online.',
    saveFailedLocal: 'Local save failed (storage blocked).',
    opened: 'Opened "{name}".',
    imported: 'Imported "{name}".',
    importFailed: 'Import cancelled, or the file is not a valid map.',
    exported: 'Downloaded "{name}".',
    newMap: 'New map started from the built-in world.',
    forked: 'Forked to "{name}". You are editing your own copy now.',
    published: 'Map published. Anyone can now find and fork it.',
    unpublished: 'Map unpublished.',
    deleted: 'Map deleted.',
    assetPlacedFirst: 'Pick an asset in the browser first.',
    loading3d: 'Loading the world...',
    playtestLaunch: 'Launching playtest...',
    playtestFailed: 'Could not start the playtest (storage blocked).',
    draftSaved: 'Draft autosaved.',
    draftRestored: 'Restored the autosaved draft.',
    autosaveFailed:
      'Autosave failed (browser storage is full or blocked). Export the map to keep a backup.',
    terrainCapReached: 'Terrain edit limit reached ({max}). Extra sculpt stamps were not added.',
    placementCapReached: 'Placement limit reached ({max}). Extra assets were not added.',
    blockerCapReached: 'Blocker wall limit reached ({max}). The new wall was not added.',
    autosaveOff: 'Autosave turned off: {reason} Save manually, then turn it back on.',
  },

  confirm: {
    ok: 'OK',
    cancel: 'Cancel',
    discardTitle: 'Discard changes?',
    discardBody: 'You have unsaved changes on "{name}". Discard them?',
    discard: 'Discard',
    conflictTitle: 'Save conflict',
    conflictBody:
      'This map changed on the server since you opened it (now v{version}). Save your version as a new copy?',
    conflictSaveCopy: 'Save As Copy',
  },

  prompt: {
    saveAsTitle: 'Save As',
    nameLabel: 'New map name',
  },

  // Server error codes ({error: 'snake_case'}) mapped client-side to these keys.
  serverError: {
    invalid_map_name:
      'That map name is not allowed. Use letters, numbers, spaces, apostrophes, or hyphens.',
    map_name_not_allowed: 'That map name is not allowed.',
    invalid_map_doc: 'The server rejected the map document.',
    invalid_version: 'The save request was malformed. Reload and try again.',
    map_limit_reached: 'You have reached the server map limit. Delete a map to save more.',
    map_not_found: 'That map no longer exists on the server.',
    version_conflict: 'The map changed on the server since you opened it.',
    slug_unavailable: 'The server could not make a link for that name. Try a different name.',
    map_too_large: 'The map document is too large to save on the server.',
    invalid_glb: 'That file is not a valid GLB model.',
    asset_blocked: 'That asset has been blocked by moderation.',
    asset_limit_reached: 'You have reached the uploaded asset limit. Delete one to upload more.',
    asset_storage_limit_reached: 'You are out of asset storage space. Delete an asset first.',
    asset_too_large: 'That model is over the upload size limit.',
    asset_not_found: 'That asset no longer exists on the server.',
    rate_limited: 'Slow down a little and try again.',
    unauthorized: 'Your session has expired. Sign in from the game again.',
    network: 'Could not reach the server. Check your connection and try again.',
    timeout: 'The server took too long to respond. Try again.',
    unknown: 'Something went wrong talking to the server.',
  },

  hints: {
    nav3d: 'Drag to orbit, scroll to zoom. While dragging, WASD flies and Q/E changes height.',
    nav2d: 'Drag to pan, scroll to zoom.',
  },

  help: {
    title: 'Editor Help',
    toolsTitle: 'Tools',
    shortcutsTitle: 'Keyboard shortcuts',
    mouseTitle: 'Mouse and navigation',
    flowTitle: 'Saving and playtesting',
    beginTutorial: 'Begin tutorial',
    close: 'Close',
    tool: {
      select: 'Pick placed assets to move, rotate, and scale them; click a 2D marker to edit it.',
      raise: 'Raise the terrain under the brush.',
      lower: 'Lower the terrain under the brush.',
      smooth: 'Smooth bumps toward the local average height.',
      flatten: 'Level the ground to the height where the drag starts.',
      paint: 'Paint biome ground cover over the zone default.',
      water: 'Set the map-wide water level.',
      place: 'Place catalog or uploaded assets on the ground.',
      blocker: 'Drag invisible walls that block movement in playtest.',
      camp: 'Add and edit mob camps that spawn in playtest.',
      spawn: 'Set where playtest drops the player.',
      region: 'Box-select terrain and assets to copy and paste.',
      erase: 'Remove placed assets or sculpt stamps under the cursor.',
    },
    key: {
      tools: 'Every tool has a single-letter shortcut, shown on its button in the tool rail.',
      brush: '[ and ] resize the brush; Shift+[ and Shift+] change its strength.',
      undo: 'Ctrl+Z undoes the last change; Ctrl+Y or Ctrl+Shift+Z redoes it.',
      save: 'Ctrl+S saves the map.',
      duplicate: 'Ctrl+D duplicates the selected asset.',
      nudge: 'Arrow keys nudge the selected asset by 0.5 yards; hold Shift for 2 yards.',
      wheel: 'Shift+scroll rotates the selected asset; Alt+scroll scales it.',
      delete: 'Delete removes the selected asset or camp.',
      escape: 'Esc clears the selection first, then returns to the Select tool.',
    },
    mouse: {
      orbit3d: '3D view: drag to orbit and scroll to zoom; middle-drag or Shift+drag pans.',
      fly3d: 'While holding a drag in 3D, WASD flies the camera and Q/E changes height.',
      move: 'With Select active, drag a placed asset to move it across the ground.',
      pan2d: '2D view: drag to pan and scroll to zoom.',
    },
    flow: {
      save: 'Save keeps the map in this browser, and on the server when you are signed in.',
      draft:
        'While you have unsaved changes, a draft is autosaved every 30 seconds; Open restores it.',
      playtest: 'Playtest boots the real game on this map, including your unsaved edits.',
    },
  },

  tutorial: {
    title: 'Editor tutorial',
    back: 'Back',
    next: 'Next',
    finish: 'Finish',
    skip: 'Skip tour',
    counter: 'Step {current} of {total}',
    steps: {
      toolbar: {
        title: 'The tool rail',
        body: 'Every editing tool lives here: sculpting brushes, biome paint, water, asset placement, camps, and more. Each one has a single-key shortcut, shown in its corner.',
      },
      stage: {
        title: 'The world',
        body: 'This is your map, rendered with the real game engine. Drag to orbit, scroll to zoom, and middle-drag or Shift+drag to pan. Click the ground with a tool to edit.',
      },
      inspector: {
        title: 'Tool options',
        body: 'The options for the active tool appear here: brush size, the biome palette, asset scale, camp settings, and the properties of whatever you select.',
      },
      viewToggle: {
        title: '3D and 2D',
        body: 'Switch between the rendered 3D world and the symbolic overhead 2D map. The 2D view is best for moving zone markers and framing large areas.',
      },
      save: {
        title: 'Save your work',
        body: 'Save stores the map in this browser, and on the server when you are signed in. Export downloads a JSON backup, and Open brings back saved maps and drafts.',
      },
      playtest: {
        title: 'Playtest',
        body: 'Boot the real game on your map at any time, with your current edits included. Close the playtest tab to come back and keep editing.',
      },
      help: {
        title: 'Help is here',
        body: 'That is the whole loop. Open Help any time for the full tool list and every shortcut, or to run this tour again.',
      },
    },
  },

  a11y: {
    stage: 'Map viewport',
    toasts: 'Editor notifications',
    dialog: 'Editor dialog',
  },
};
