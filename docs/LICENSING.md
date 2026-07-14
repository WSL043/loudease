# Licensing decision and transition

This document records why LoudEase uses GPL-3.0-only and where that decision does and does not apply. It is an engineering and governance record, not legal advice.

## Decision

Current and future LoudEase source code is distributed under **GNU General Public License version 3 only** (`GPL-3.0-only`).

LoudEase is a complete end-user browser extension rather than an embedding-oriented library or SDK. The project wants users and contributors to retain access to the corresponding source of distributed derivative extensions. GPLv3 fits that goal more closely than file-level copyleft.

## Why not MPL-2.0

MPL-2.0 requires modified files containing MPL code to remain available, but permits separate new files in a larger proprietary work. That is useful for libraries and commercial integration, but it permits an extension fork to keep the original core files open while placing substantial new behavior in closed files.

GPLv3 applies its copyleft to a distributed work based on GPL code as a whole, subject to the license's definitions and exceptions. It does not prohibit forks, commercial use, or charging money; it requires compliant distribution and corresponding source.

## Why `only`, not `or-later`

`GPL-3.0-only` fixes the project to the reviewed GPLv3 terms. It does not automatically authorize recipients to adopt a future GPL version whose text does not yet exist. A future move to another license version requires a deliberate project decision and sufficient rights in the affected code.

`GPL-3.0-or-later` would improve automatic compatibility with a future GPL version, but would delegate that future choice to recipients. LoudEase currently prioritizes predictable terms and founder-led review, so the exact-version form is used.

## Historical releases

The tags `v0.7.0-beta.1`, `v0.7.1-beta.1`, and `v0.7.1-beta.2` were distributed under MPL-2.0. Those grants remain valid for copies received under those tags and are not revoked.

The GPL transition applies from the commit that replaces the root license and project metadata. Future release notes and source archives must identify that commit or a later GPL-licensed tag.

## Contribution and commercial boundary

Contributors retain copyright and submit code under GPL-3.0-only using the DCO process. The DCO does not assign copyright and does not grant a separate proprietary relicensing right.

WSL043 may separately use or license code for which WSL043 owns all necessary rights. Accepted third-party contributions cannot be moved into a proprietary product without a separate legal basis, permission from the relevant rights holders, or a clean-room replacement. Any future contributor agreement must be explicit and reviewed before use.

## Brand and third-party assets

GPL-3.0-only covers first-party program source and project documentation unless a file is identified otherwise. It does not license the LoudEase name, logo, icon, waveform mark, or official screenshots. Those assets are governed by `TRADEMARKS.md` and `LICENSES/LicenseRef-LoudEase-Brand.txt`.

Lucide and Feather interface icons remain under their ISC and MIT licenses. Exact notices are in `THIRD_PARTY_NOTICES.md`; machine-readable file mappings are in `REUSE.toml`.

## What GPL cannot prevent

The license does not prevent anyone from using, studying, modifying, forking, selling, or competing with LoudEase. It also cannot stop an independent reimplementation. It provides enforceable distribution conditions; the trademark policy, official publishing accounts, governance, and release provenance protect the identity of the official project.

## Primary references

- [GNU General Public License version 3](https://www.gnu.org/licenses/gpl-3.0.html)
- [GNU GPL FAQ](https://www.gnu.org/licenses/gpl-faq.html)
- [Mozilla MPL 2.0 FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)
- [Developer Certificate of Origin 1.1](https://developercertificate.org/)
- [REUSE specification and guidance](https://reuse.software/)
