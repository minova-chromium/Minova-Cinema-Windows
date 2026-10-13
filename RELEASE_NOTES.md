# Minova Cinema Desktop 1.0.9

This update makes desktop playback feel faster and more polished, restores reliable audio/video synchronization, refreshes the Minova branding, and ensures automatic updates use the custom Minova updater.

## Highlights

- Reworks the native player controls for quicker interaction, clearer feedback, and a cleaner cinema-style layout.
- Uses the native audio clock as the playback source of truth to prevent sound drifting out of sync after the responsiveness work.
- Replaces the retired low-resolution and Prism-style artwork throughout the app, loading states, placeholders, executable, and installer.
- Preserves the supplied 8000×4500 Minova and Minova Cinema masters and regenerates all desktop brand assets during packaging.
- Routes both automatic and manual updates through the polished custom Minova updater instead of exposing the raw NSIS installer.
- Adds automated coverage for brand assets, audio-clock synchronization, release metadata, and the updater launch contract.
- Includes the approved cinematic Movies and TV design concepts as repository documentation for future implementation.

Users on 1.0.0 need to install a newer build manually once because 1.0.0 did not contain the updater. Versions 1.0.2 and newer can discover and install this release from inside the app.

## Installer verification

`Minova-Cinema-Desktop-1.0.9-Setup.exe`

SHA-256: `BC5B437FC413217EFADA5D2CA84F8E50C65217FABC25AE4B71A6F4CB7DD93795`
