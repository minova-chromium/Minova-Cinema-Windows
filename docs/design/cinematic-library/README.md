# Minova cinematic Movies and TV design concept

Status: approved as a design direction for later; not yet implemented.

Reference: [Plex Android TV / Google TV walkthrough, starting at 0:29](https://youtu.be/aPUhzEF8E0g?t=29).

## Scope

Use this presentation specifically for Movies and TV Shows across Minova applications. Do not automatically apply the full-bleed cinematic layout to settings, device management, live TV, or other utility screens.

The visual language can inform the wider Minova design system—typography, spacing, focus behavior, controls, and color—but content-heavy cinematic artwork belongs to Movies and TV Shows.

## Approved direction

- Full-bleed backdrop art that fades naturally into Minova's deep navy-black surfaces.
- Compact, low-noise navigation that keeps the selected title dominant.
- Minova cyan (`#13D7EB`) used sparingly for the primary action, active section, progress, and current focus.
- One unmistakable focus target: a crisp cyan border, slight scale increase, and restrained underglow.
- Metadata and synopsis integrated into the hero instead of placed inside dashboard cards.
- Content rows visually overlap or emerge from the hero gradient.
- Minimal borders and panels; generous negative space and TV-distance typography.
- Preserve the Minova symbol, wordmark, geometric typography, and existing cinema identity.
- Use real Plex artwork and metadata when implemented; the mockups use fictional material only.

## Movies

The browse screen combines a selected-title hero with Continue Watching and Recently Added rows. Opening a movie leads to a dedicated detail screen containing:

- Play, Trailer, Watchlist, and More actions.
- Year, duration, quality, rating, genres, synopsis, director, and cast.
- A More Like This carousel using the same focus treatment.

## TV Shows

Opening a series uses the same cinematic shell, with TV-specific controls:

- Resume episode and Trailer actions.
- Overview and season tabs.
- A selected-episode synopsis.
- Wide episode cards with episode number, title, duration, and progress.
- Season/episode state should be immediately obvious without opening another panel.

## Mockups

- [Movies browse concept](movies-browse-concept.png)
- [Movie detail concept](movie-detail-concept.png)
- [TV show detail concept](tv-show-detail-concept.png)

These images are visual references, not pixel-perfect implementation specifications. Production layouts must remain responsive, performant, accessible, and controller-friendly on desktop and Android/TV.
