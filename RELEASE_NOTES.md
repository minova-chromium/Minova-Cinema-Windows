# Minova Cinema Desktop 1.0.4

This release adds secure Plex browser sign-in, automatic server discovery, and a desktop-focused library browser while preserving the established Minova Cinema interface and native playback experience.

## Highlights

- Adds official Plex browser sign-in without requiring the Plex desktop or mobile app and without copying a Plex token.
- Opens Plex's prefilled four-character link page in the default browser and keeps a visible manual code and reopen action in Minova.
- Discovers owned and shared Plex Media Servers automatically, offers a clean server chooser, and prefers local, direct-remote, then relay connections.
- Keeps advanced manual server and token setup for reverse proxies, Tailscale, and custom addresses.
- Creates a stable per-install Plex client identity and uses it consistently for discovery, browsing, playback, transcodes, and saved sessions.
- Encrypts the selected server token with Windows secure storage; account tokens never enter the renderer or settings file.
- Groups Search, Rows/Grid, and Settings together at the right side of the desktop header.
- Replaces the limited genre buttons with a complete genre selector and a shelf for every available genre.
- Rebuilds Home around Continue Watching, New Releases, one fresh viewing-based recommendation row, Top Picks, genre picks, Top Rated, Hidden Gems, Recently Added, Watch Again, and Watchlist discovery without duplicate Movies or Series rows.
- Refreshes recommendation signals immediately after playback closes and then reconciles them with fresh Plex history.
- Removes the redundant All titles shelf from Movie and Series row views in favor of personalized and genre shelves.
- Moves contextual left/right shelf controls into the section heading, with the left arrow appearing only after moving right.
- Keeps the mouse wheel dedicated to vertical page scrolling while shelf arrows control horizontal movement.
- Adds an A–Z index plus direct letter-key jumping for Movies and Series, with a saved choice between a continuous grid and separate letter sections.
- Matches Android series playback logic: Play starts the first episode, Resume returns to an in-progress episode, and completed episodes advance to the next unwatched episode.
- Adds Ctrl+F search and documents the desktop shortcuts in Settings.
- Preserves the redesigned interface, mini player, native libmpv playback, automatic recovery, and in-app updater from 1.0.3.

Users on 1.0.0 need to install a newer build manually once because 1.0.0 did not contain the updater. Versions 1.0.2 and newer can discover and install this release from inside the app.

## Installer verification

`Minova-Cinema-Desktop-1.0.4-Setup.exe`

SHA-256: `8A830107F6756537A0D53BE4A919986915D0032C3771E1BBC64FE52814F68C46`
