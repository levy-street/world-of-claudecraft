# Vehicle HUD

Reusable personal-vehicle chrome, composed by Hud through IWorld and shared writers.
The aim and view cores own no DOM or authoritative outcomes. The controller uses
the existing ActionBarPainter family and never changes saved normal action bars.
Exit and session loss clear local aim. No independent frame loop or storage.
The shadow, forge and Morthen (Graveyard Shift) bars are sub-controllers the vehicle
controller composes: each owns its root, and the static blocksPlayerActions routes the
slot keys to the one that is active. Morthen keys on the identity aura alone.
