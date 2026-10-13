# Minova brand assets

The supplied 8000×4500 Minova artwork is the canonical brand source for Minova Cinema Desktop.

## Masters

- `assets/minova-master-8000.png` — general Minova wordmark master.
- `assets/minova-cinema-master-8000.png` — stacked Minova Cinema lockup master.

Do not replace these with screenshots, upscaled legacy artwork, or the retired Prism-M asset.

Run `pnpm run prepare:brand` to regenerate:

- `assets/minova-wordmark.png`
- `assets/minova-cinema-wordmark.png`
- `assets/minova-symbol-color.png`
- `assets/minova-cinema.ico`

The desktop renderer, loading/splash state, placeholders, player underlay, update dialog, window icon, installer artwork, installer executable, and packaged executable must all use these generated assets.

## Android follow-up

Android and Android TV have not been changed in this desktop task. At the start of the next Android session, use the two canonical masters above to replace every legacy launcher icon, adaptive icon layer, splash-screen logo, in-app wordmark, placeholder, notification/update mark, and marketing image. Preserve the existing Android application ID and release signing identity.
