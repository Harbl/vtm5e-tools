# VtM5e Tools

A bundle of Foundry VTT modules for **Vampire the Masquerade 5th Edition**, built on top of the [wod5e](https://github.com/Zennore/wod5e) system. Covers character sheets, chat cards, GM automation, character creation, XP spending, and a coterie party sheet - plus standalone compendiums for Clans, Disciplines, Paths, Predator Types, Merits/Flaws/Backgrounds, Loresheets, and Equipment.

Everything is independently toggleable from **Manage Modules** - turn off anything you don't want (e.g. the automation layer, or swap in a different character sheet) without breaking the rest.

## Requirements

- Foundry VTT v13+
- The [wod5e](https://foundryvtt.com/packages/wod5e) game system
- The V5 rulebooks - the compendiums here transcribe rules text (clan Banes, Discipline powers, Merit/Flaw descriptions, etc.) from the Core Rulebook, Player's Guide, Chicago by Night, and Cults of the Blood Gods. You should own those books.

## Install

In Foundry's Install Module dialog, paste this manifest URL:

```
https://github.com/Harbl/vtm5e-tools/releases/latest/download/vtm5e-tools.json
```

`vtm5e-tools` itself has no code - it just declares the modules below as dependencies. Installing it pulls in the rest automatically.

The install URL becomes available after the first release is published. For an
individual module, replace `vtm5e-tools.json` with its ID plus `.json` in that URL.
Use release manifests for installation; raw source manifests are development files.

## Releases

Push a stable version tag to publish all 14 modules together:

```sh
git tag v1.1.0
git push origin v1.1.0
```

Use an increasing `vMAJOR.MINOR.PATCH` tag for each subsequent release. Start with
`v1.1.0` so the release version is newer than every existing module version.
The GitHub Actions workflow builds 14 separate ZIPs and 14 manifests, uploads
them to a draft release, then publishes it as the latest release. It uses the
built-in `GITHUB_TOKEN` with `contents: write`; no extra secret is needed.
If an upload fails, delete the incomplete draft before rerunning the workflow.

Each ZIP contains `module.json` at its root, module files (including complete
compendium databases), and the license. Generated manifests use the tag's version,
an immutable download URL, and dependency manifests from that same release.
Their own manifest URL tracks the latest release for Foundry's update checks.
Source manifests and their original per-module versions are not rewritten by CI.

Validate and build locally using Python 3.12 (no third-party dependencies):

```sh
python scripts/build_release.py
python -m unittest discover -s tests -v
python scripts/build_release.py --tag v1.1.0 --output dist
```

The output directory must be empty. Pull requests and pushes to `master` run
the release packaging tests automatically.

## What's included

**Compendiums**
- `vtm5e-clans` - all 16 clans (14 major + Caitiff + Thin-Blooded)
- `vtm5e-disciplines` - corebook Discipline powers
- `vtm5e-paths` - Paths of Enlightenment
- `vtm5e-predatortypes` - all 16 corebook Predator Types
- `vtm5e-meritsflaws` - Merits, Flaws, and Backgrounds
- `vtm5e-loresheets` - Loresheets
- `vtm5e-equipment` - a modern Chicago-flavored weapons/armor/gear catalog, built around a weapon-tag system

**Gameplay**
- `vtm5e-automation` - damage application, opposed rolls, weapon/armor condition tracking, and other GM-facing conveniences
- `vtm5e-charactersheet` - a reskinned Vampire actor sheet
- `vtm5e-chatcards` - a reskinned roll chat card
- `vtm5e-chargen` - a step-by-step character creation wizard that applies Clan/Predator Type grants automatically
- `vtm5e-xpshop` - a cart-based Experience spending shop, priced per the corebook's Trait Costs table
- `vtm5e-coterie` - a party sheet covering coterie-shared Backgrounds, trackers (Chasse/Lien/Portillon), members, and gear. Opens from a crown icon on the Actors sidebar folder header.

## License

Code is MIT licensed. Compendium content is transcribed from Vampire the Masquerade 5th Edition sourcebooks, copyright Paradox Interactive / White Wolf Entertainment AB - provided here for personal/community tabletop use, not as a substitute for owning the books.
