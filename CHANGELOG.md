---
title: What's New
---

# 0.1.1

## Other Changes

- Released as `npm` public module

# 0.1.0

## ✨ Enhancements

- `hq-stats collect`: daily snapshot of every public repo in `repos.toml` (GitHub stars, traffic and release
  downloads, npm, PyPI, GHCR, Home Assistant analytics, GoatCounter page views). Ported from Rhizomatics HQ's
  `collect_stats.py`, same snapshot format, now also recording each repo's description and archive state.
- `hq-stats build`: the public aggregate (`stats.json`, format 1) from the snapshots.
- Astro integration and sidebar helper: Downloads, Page views and per-component pages for Starlight sites.
