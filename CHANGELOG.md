---
title: What's New
---

# 0.3.0

## ✨ Enhancements

- Products, product lines and artefacts: the configuration is now `hq.toml` (the org, `[stats]`, `[lines]` in
  display order, `[platforms]`), `products.toml` (one table per product: `line`, `repos`, `significance`,
  `lifecycle`, `public`, `platform`, and `artefacts.<name>` for each package, release asset or website it's
  delivered as) and, optionally, `community.toml`. See the README's Configuration section.
- A product can be built in several repos (`repos = [...]`); its stars, traffic and release downloads are summed.
  Its slug can differ from its repo's name. Each repo belongs to one product.
- `hq-stats migrate` writes the three files from a `repos.toml`. Families become lines (`meta` a line with
  `kind = "org"`), `upstream` becomes `platform`, `category` becomes `significance`, `lifecycle` and `public`, and
  the channel fields become artefacts. Snapshots and page URLs don't change.
- `stats.json` is format 2: components, websites and community projects gain `line`, and components `repos`.
  `family` stays, with the same value as `line`, until 1.0.
- The library exports `loadConfig` (one normalised model, whichever layout it read), `fromLayout`,
  `reposTomlToLayout`, `channels`, `lines`, `isProduct` and `migrate`, so a host site can read the same config.

## Deprecated

- `repos.toml` is still read, with a one-line notice, until at least 1.0 and not before 2027-06-01. Run
  `hq-stats migrate`, check the files, then delete it.
- In `stats.json`, `family` (use `line`); in the pages' helpers, `FAMILIES` and `familyLabel` (use `LINES` and
  `lineLabel`). All go at 1.0.

# 0.2.3

## Other Changes

- GoatCounter page views: a 404 from the stats API is retried, and a failure now records which call failed and
  the start of GoatCounter's error body (`HTTP 404 on stats/hits: ...`) instead of a bare `HTTP 404`.
- HTTP errors keep the first 200 characters of the response body for diagnosis.

# 0.2.2

## ✨ Enhancements

- Renamed products keep their history: an optional `formerly = { name, hacs_zip, npm, pypi, ha_domain }` on a repo
  or community project in `repos.toml`, each one name or a list. Snapshots taken under the old repo name are read
  under the new one; release downloads count the old asset name too; old npm and PyPI packages' downloads and old
  Home Assistant domains' installs are added to the current ones.

## Other Changes

- Stronger string escaping and regex handling: scoped npm package names are encoded for the npm API without a
  partial replace, and the `base` option is trimmed of slashes without a backtracking regex (CodeQL alerts).

# 0.2.1

## Other Changes

- The Downloads and Page views pages end with a line crediting hq-stats, linking to its GitHub repo.

# 0.2.0

## ✨ Enhancements

- Community projects: `[community.<id>]` entries in `repos.toml` (other people's projects built on yours) are
  snapshotted under `community` from public sources only, built into a `community` list in `stats.json` (never in
  the components or any total), and shown on a Community page at `<base>/community/`, with a sidebar entry.
- Brand: the hq-stats logo (`@rhizomatics/hq-stats/brand/logo.svg`, built from the HQ mark by
  `docs/brand/make-logo.mjs`) and an optional theme in the HQ family (`@rhizomatics/hq-stats/theme.css`), both used
  by the standalone example.
- `examples/publish-stats.yml`: publish the pages on GitHub Pages after each day's collection.

## Other Changes

- Docs: personal accounts work as the `org`; when history and daily figures start; setting `site` and `base` for a
  project site. `examples/collect-stats.yml` keeps no credentials in the checkout and pins 0.2.0.
- `collect` prints an absolute path when the data directory is outside the working directory.

# 0.1.1

## Other Changes

- Released as `npm` public module
- Added `prek` for pre-commit checks and `mise` for project tooling

# 0.1.0

## ✨ Enhancements

- `hq-stats collect`: daily snapshot of every public repo in `repos.toml` (GitHub stars, traffic and release
  downloads, npm, PyPI, GHCR, Home Assistant analytics, GoatCounter page views). Ported from Rhizomatics HQ's
  `collect_stats.py`, same snapshot format, now also recording each repo's description and archive state.
- `hq-stats build`: the public aggregate (`stats.json`, format 1) from the snapshots.
- Astro integration and sidebar helper: Downloads, Page views and per-component pages for Starlight sites.
