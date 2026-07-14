# Asset provenance

This inventory records the origin and license boundary of non-code assets distributed with LoudEase. It is evidence for maintainers, not a claim that copyright exists where applicable law does not recognize it.

## LoudEase brand assets

| Files | Origin | Distribution boundary |
|---|---|---|
| `assets/logo-ai-a-light.png`, `assets/logo-ai-a-dark.png` | AI-assisted generation from a waveform identity concept directed and selected by WSL043 during private product development | Not offered under GPL-3.0-only; governed by `TRADEMARKS.md` and `LICENSES/LicenseRef-LoudEase-Brand.txt` |
| `assets/icon-16.png`, `assets/icon-32.png`, `assets/icon-48.png`, `assets/icon-128.png` | Raster sizes derived from the selected LoudEase logo | Same brand-asset boundary |
| `docs/popup-screenshot-*.png`, `docs/settings-screenshot-*.png` | Captured from the current first-party extension UI with test state and no private browsing content | May be reused for truthful review and documentation as described in `TRADEMARKS.md`; not licensed as program source |

Modified distributions must replace the LoudEase name, logo, and icons with a distinct identity. Unmodified official builds may be redistributed under the conditions in `TRADEMARKS.md`.

## Interface icons

| Files | Origin | License |
|---|---|---|
| `assets/moon.svg` | Lucide `moon`, derived from Feather Icons | MIT |
| `assets/settings.svg`, `assets/sun.svg` | Lucide Icons | ISC |

The required copyright and permission notices are reproduced in `THIRD_PARTY_NOTICES.md`; machine-readable mappings are in `REUSE.toml`.

## Typography

LoudEase does not bundle font files. The CSS requests `Inter` and then falls back to browser and operating-system UI fonts. No font binary is redistributed by the repository or extension package.

## Test media and audio

The tracked test pages synthesize tones, noise, bursts, and envelopes at runtime. No third-party programme audio, personal recording, or commercial media file is committed. Maintainer-only listening samples must remain outside the repository under the ignored private-corpus paths documented in `docs/DATA_GOVERNANCE.md`.

## Updating this file

Any new image, icon, font, sound, recording, generated asset, or copied code fragment must add its exact source, author or generator, license, modification history, and redistribution permission before merge. Unknown provenance is a release blocker.
