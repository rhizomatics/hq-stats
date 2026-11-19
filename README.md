# hq-stats

Usage stats for open source projects, from every channel they publish to, with public pages or raw JSON.
No AI, no cookies, no accounts beyond the tokens you already have.

- **Downloads**: PyPI, npm, GitHub Container Registry, HACS (Home Assistant's community store) release downloads
- **Installs**: Home Assistant's public analytics for custom integrations
- **GitHub**: stars, repo page views and clones (GitHub keeps 14 days; hq-stats snapshots them daily so they're kept)
- **Websites**: page views from [GoatCounter](https://www.goatcounter.com/), which needs no cookie banner

It's the stats part of [Rhizomatics HQ](https://hq.rhizomatics.org.uk/usage/), where you can see the pages it
makes. You don't need the rest of HQ to use it.

## How it works

1. You list your repos in a `repos.toml`, with the channels each one publishes to.
2. A scheduled GitHub Actions workflow runs `hq-stats collect` once a day and commits a snapshot
   (`data/stats/YYYY-MM-DD.json`) to your repo.
3. `hq-stats build` turns the snapshots into one public aggregate, `stats.json`.
4. Show it with the built-in pages (an Astro/Starlight integration), or use `stats.json` in your own pages.

Everything is assumed public: private repos are skipped, and nothing beyond counts is stored (no referrers, no
visitor details). If you want your figures private, keep the repo holding them private.

## Set up

### repos.toml

```toml
[org]
github = "my-org" # GitHub org or user that owns the repos
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
```

Other optional fields per repo: `archived = true` (left off the pages), `category = ["experimental"]` (not
counted as a product site) or `["internal"]` (left out), `description` (used until the first snapshot has one).

### Tokens

- `GITHUB_TOKEN`: a fine-grained token for your repos with **Metadata: read** and **Administration: read**
  (GitHub's traffic API needs the latter). Locally, a logged-in `gh` CLI works too.
- `GOATCOUNTER_TOKEN` (optional): a GoatCounter API key with **Read statistics**.

### Daily workflow

Copy [examples/collect-stats.yml](examples/collect-stats.yml) to `.github/workflows/` in the repo with your
`repos.toml`, and add the secrets it names. It runs on a schedule and by hand, never on pull requests.

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

Run `hq-stats build` before `astro build`. The pages are mounted at `/usage/` (Downloads), `/usage/page-views/`
and `/usage/<repo>/`. They need `chart.js` installed alongside. For a site with nothing else, start from
[examples/standalone](examples/standalone).

Chart colours are CSS variables (`--viz-1` … `--viz-4`, `--viz-text`, …) you can override in your own CSS.

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
