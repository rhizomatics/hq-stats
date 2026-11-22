---
title: What's New
---

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
