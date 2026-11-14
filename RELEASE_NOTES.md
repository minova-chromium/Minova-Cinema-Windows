# Minova Cinema Desktop 1.1.1

This playback update adds native Plex intro and credits skipping and gives quiet media additional volume headroom without changing the established desktop interface.

## Highlights

- Shows a contextual **Skip intro** button while playback is inside a valid Plex intro marker.
- Shows a contextual **Skip credits** button while playback is inside a valid Plex credits marker.
- Seeks to Plex's exact marker endpoint instead of estimating intro or credits timings.
- Extends native playback volume from 100% to 250%, with 100% retained as the normal reference level.
- Displays the current volume percentage and highlights levels above 100% as boosted.
- Remembers the selected boosted volume between playback sessions.
- Keeps the existing Stable and Experimental desktop interfaces, mini-player, native playback, offline LAN support, automatic updater, and branded installer intact.

Skip controls require the Plex server to provide an intro or credits marker for the playing item. Titles without marker data continue playing normally without showing a skip button.

Users on 1.0.0 need to install a newer build manually once because 1.0.0 did not contain the updater. Versions 1.0.2 and newer can discover and install this release from inside the app.

## Installer verification

`Minova-Cinema-Desktop-1.1.1-Setup.exe`

SHA-256: `D5D62B891368B59EA7C67A70C31E8E13B066E0FD13EF81D9118E77F1E367AFA3`
