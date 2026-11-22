<img src="docs/brand/logo.svg" alt="hq stats" width="96" align="right">


[![Rhizomatics Open Source](https://img.shields.io/badge/rhizomatics%20open%20source-lightseagreen)](https://github.com/rhizomatics) [![managed by hq](https://raw.githubusercontent.com/rhizomatics/hq/main/assets/badge-managed-by-hq.svg)](https://hq.rhizomatics.org.uk/) [![npm version](https://img.shields.io/npm/v/@rhizomatics/hq-stats.svg)](https://www.npmjs.com/package/@rhizomatics/hq-stats)
[![npm downloads](https://img.shields.io/npm/dm/@rhizomatics/hq-stats.svg)](https://www.npmjs.com/package/@rhizomatics/hq-stats)

# hq-stats

Usage stats for open source projects, from every channel they publish to, with public pages or raw JSON.
No AI, no cookies, no accounts beyond the tokens you already have.

- **Downloads**: PyPI, npm, GitHub Container Registry, HACS (Home Assistant's community store) release downloads
- **Installs**: Home Assistant's public analytics for custom integrations
- **GitHub**: stars, repo page views and clones (GitHub keeps 14 days; hq-stats snapshots them daily so they're kept)
- **Websites**: page views from [GoatCounter](https://www.goatcounter.com/), which needs no cookie banner
- **Community**: projects other people build on yours (plugins, cards, add-ons), from their public figures only,
  shown on their own page and never added to your totals

It's the stats part of [Rhizomatics HQ](https://hq.rhizomatics.org.uk/usage/), where you can see the pages it
makes. You don't need the rest of HQ to use it, or an organisation: a personal GitHub account works the same way.

## How it works

1. You list your repos in a `repos.toml`, with the channels each one publishes to.
2. A scheduled GitHub Actions workflow runs `hq-stats collect` once a day and commits a snapshot
   (`data/stats/YYYY-MM-DD.json`) to your repo.
3. `hq-stats build` turns the snapshots into one public aggregate, `stats.json`.
4. Show it with the built-in pages (an Astro/Starlight integration, publishable on GitHub Pages), or use
   `stats.json` in your own pages.

Everything is assumed public: private repos are skipped, and nothing beyond counts is stored (no referrers, no
visitor details). If you want your figures private, keep the repo holding them private.

## Set up

### repos.toml

```toml
[org]
github = "my-org" # GitHub org, or your own user name, that owns the repos
name = "My Org" # display name

[stats] # optional; paths relative to this file
data_dir = "data/stats" # snapshots (default)
out = "data/stats.json" # the aggregate `build` writes (default: next to data_dir)

[families] # optional: headings, in display order
library = { label = "Libraries" }
meta = { label = "Organisation" } # `meta`: your own sites; shown under page views only

[repos.my-library]
family = "library"
pypi = "my-library" # PyPI package
npm = "@my-org/my-lib" # npm package
ghcr = "my-image" # container image under ghcr.io/<org>/
hacs_zip = "my_integration.zip" # the release asset HACS downloads
ha_domain = "my_integration" # Home Assistant integration domain, for install counts
goatcounter = "my-library-docs" # GoatCounter site code for the project's website

[repos.www]
family = "meta"
goatcounter = "my-org"

[community.my-library-card] # optional: someone else's project built on one of yours
repo = "someone/my-library-card" # owner/name on GitHub
author = "someone" # GitHub login (default: the repo's owner)
extends = "my-library" # which of your repos it builds on
hacs_zip = "my-library-card.js" # the same channel fields as a repo: npm, pypi, ghcr, hacs_zip, ha_domain
```

Other optional fields per repo: `archived = true` (left off the pages), `category = ["experimental"]` (not
counted as a product site) or `["internal"]` (left out), `description` (used until the first snapshot has one).

Community projects are collected from public sources only (stars, releases, downloads; no traffic, which only
their authors can see), stored under `community` in the snapshots and the aggregate, and shown on a Community page.
Entries with `kind = "blog"`, or without a `repo`, are ignored, so the table can list other things too.

### Tokens

- `GITHUB_TOKEN`: a fine-grained token for your repos with **Metadata: read** and **Administration: read**
  (GitHub's traffic API needs the latter). Create it under the organisation as resource owner, or your own account
  for personal repos. Locally, a logged-in `gh` CLI works too.
- `GOATCOUNTER_TOKEN` (optional): a GoatCounter API key with **Read statistics**.

### Daily workflow

Copy [examples/collect-stats.yml](examples/collect-stats.yml) to `.github/workflows/` in the repo with your
`repos.toml`, and add the secrets it names (as `STATS_TOKEN` and `GOATCOUNTER_TOKEN`). It runs on a schedule and
by hand, never on pull requests. Run it once by hand to check: it commits `data/stats/<today>.json` and
`data/stats.json`.

GitHub only keeps 14 days of traffic, so history starts with your first snapshot; download counters that only
give a lifetime total (HACS, GHCR) show daily figures from the second.

### Pages

In an Astro site with [Starlight](https://starlight.astro.build/):

```js
// astro.config.mjs
import starlight from "@astrojs/starlight";
import hqStats from "@rhizomatics/hq-stats/astro";
import { usageSidebar } from "@rhizomatics/hq-stats/sidebar";

const options = { config: "../repos.toml" }; // also: stats (path to stats.json), base (default 'usage')

export default defineConfig({
  integrations: [starlight({ title: "My Org", sidebar: [{ label: "Usage", items: usageSidebar(options) }] }), hqStats(options)],
});
```

Run `hq-stats build` before `astro build`. The pages are mounted at `/usage/` (Downloads), `/usage/page-views/`,
`/usage/<repo>/` and, when `repos.toml` lists community projects, `/usage/community/`. They need `chart.js`
installed alongside.

For a site with nothing else, copy [examples/standalone](examples/standalone) to `site/` next to your
`repos.toml`, set `site` (and `base`, for a project site such as `https://<owner>.github.io/<repo>/`) in its
`astro.config.mjs`, and run `npm install` there. To publish it on GitHub Pages, copy
[examples/publish-stats.yml](examples/publish-stats.yml) to `.github/workflows/` and set Pages' source to
"GitHub Actions" in the repo's settings.

The standalone example uses the hq-stats logo and colours (`@rhizomatics/hq-stats/brand/logo.svg`,
`@rhizomatics/hq-stats/theme.css`); swap in your own logo and drop `theme.css` to use your colours. Chart colours
are CSS variables (`--viz-1` … `--viz-4`, `--viz-text`, …) you can override in your own CSS.

### Raw data

`stats.json` is documented in [docs/data-format.md](docs/data-format.md), and so are the daily snapshots. Both are
versioned with the package; a breaking change to either is a major version.

## Commands

```text
hq-stats collect   snapshot every public repo in repos.toml (run daily)
hq-stats build     write stats.json from the snapshots

  --config <path>   repos.toml (default: $REPOS_TOML, ./repos.toml, ../repos.toml)
  --data <dir>      snapshot directory
  --legacy <file>   history from the retired hacs-downloads site, if you have it
  --out <file>      where build writes stats.json
  --offline         build from snapshots only, without live npm, PyPI and Home Assistant calls
```

## What the numbers mean

None of the counters counts people. Downloads include updates, CI and mirrors; Home Assistant installs only cover
installations that opted in to analytics; GitHub's traffic includes bots; GoatCounter counts one view per page per
visitor session. The pages say this next to each figure.

## Licence

Apache 2.0.
