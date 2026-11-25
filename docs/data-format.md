# Data formats

hq-stats writes two kinds of file. Both are public by design and versioned with the package: a breaking change
to either is a major version of `@rhizomatics/hq-stats`. Adding fields is not breaking; ignore what you don't know.

Dates are `YYYY-MM-DD` in UTC. A **daily series** is an object from date to that day's figure.

## Daily snapshot: `<data_dir>/YYYY-MM-DD.json`

Written by `hq-stats collect`, one per day, keys sorted. Holds raw counters as the sources report them; the
aggregate turns them into series.

```jsonc
{
  "collected_at": "2026-11-19T04:23:00+00:00",
  "repos": {
    "<repo>": {
      "github": {
        "description": "…",
        "archived": false, // from 0.1.0
        "stars": 25,
        "forks": 3,
        "watchers": 4,
        "open_issues_and_prs": 7,
        "views": [{ "timestamp": "2026-11-05T00:00:00Z", "count": 12, "uniques": 4 }], // last 14 days
        "clones": [{ "timestamp": "2026-11-05T00:00:00Z", "count": 30, "uniques": 9 }], // last 14 days
        "release_assets": { "<tag>": { "<asset name>": 123 } }, // lifetime download counts, latest 100 releases
      },
      "npm": { "last_week": 120, "last_month": 480 },
      "pypi": { "last_day": 10, "last_week": 70, "last_month": 300 },
      "ghcr": { "total": 88551 }, // lifetime pulls
      "ha_installs": 96, // Home Assistant installs reporting the integration
      "goatcounter": {
        "site": "<code>",
        "daily": { "2026-11-18": 7 }, // the 14 complete days before the snapshot
        "top_pages_30d": [{ "path": "/", "title": "…", "count": 9 }],
      },
    },
  },
}
```

- `repos` is keyed by repo, not product. A product's channel objects (`npm`, `pypi`, `ghcr`, `ha_installs`,
  `goatcounter`) are on its first public repo's entry; `build` puts a product of several repos together again.
- `community` (from 0.2.0, only when there are community projects): one entry per community project, keyed by its
  id, holding `github` (`description`, `archived`, `license`, `stars`, `forks`,
  `latest_release` as `{ tag, date, url }` or null, `release_assets`) and the same channel objects as a repo
  (`npm`, `pypi`, `ghcr`, `ha_installs`). No traffic or page views.
- Only public repos appear, ours or community. A channel appears only if the product has an artefact it counts.
- A source that failed is `{ "error": "<message>" }` in place of its object (also `views` and `clones` on their
  own, e.g. without traffic access).
- GitHub traffic and GoatCounter windows overlap from one snapshot to the next; the latest snapshot to mention a
  day wins, and a snapshot's own day is ignored as partial.

## Aggregate: `stats.json`

Written by `hq-stats build`. What the pages show, and the interface for your own pages. TypeScript types are in
[src/astro/types.ts](../src/astro/types.ts).

```jsonc
{
  "format": 2, // 1 before 0.3.0
  "generatedAt": "2026-11-19T06:00:00.000Z",
  "org": { "name": "My Org", "github": "my-org" },
  "snapshotDate": "2026-11-19", // the latest snapshot
  "firstSnapshot": "2026-09-12", // the earliest date with data (legacy history included)
  "pageViewsSince": "2026-11-17", // the first snapshot with GoatCounter data, or null
  "notes": ["…"], // sources missing at build, one sentence each
  "components": [/* every public, unarchived product, except those on an org line */],
  "websites": [/* every product with a `website` artefact, org lines included */],
  "community": [/* from 0.2.0: community projects, never counted in the components or any total */],
}
```

### Component

| Field                                           | Meaning                                                                                                                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `description`, `url`                      | the product's slug, its GitHub description (its first repo's) and URL                                                                                                                                         |
| `line`                                          | from format 2: its product line, or null                                                                                                                                                                      |
| `family`                                        | the same as `line` (format 1's name for it); dropped at 1.0                                                                                                                                                   |
| `repos`                                         | from format 2: its public repos; GitHub figures are summed across them                                                                                                                                        |
| `major`                                         | `significance = "major"`                                                                                                                                                                                      |
| `channels`                                      | download channels with data: `hacs`, `npm`, `pypi`, `ghcr`                                                                                                                                                    |
| `downloads`                                     | daily series per channel. HACS and GHCR are lifetime counters turned into daily figures (a gap between snapshots is spread evenly; a drop counts as zero). npm and PyPI are the registries' own daily figures |
| `kpis.downloads7`, `kpis.downloads30`           | all channels, the 7 and 30 days to `snapshotDate`                                                                                                                                                             |
| `kpis.totals`                                   | lifetime per channel where known (`npm`: the last 18 months)                                                                                                                                                  |
| `kpis.stars`, `kpis.starsChange7`               | stars now, and the change over 7 days                                                                                                                                                                         |
| `kpis.haInstalls`                               | Home Assistant installs reporting today                                                                                                                                                                       |
| `kpis.views7`, `kpis.views30`                   | website page views, or null without a website                                                                                                                                                                 |
| `kpis.clones14`, `kpis.repoViews14`             | GitHub clones and repo page views, last 14 days                                                                                                                                                               |
| `stars`, `haInstalls`                           | daily series                                                                                                                                                                                                  |
| `clones`, `repoViews`                           | per day: `{ "count": n, "uniques": n }`; uniques are per day                                                                                                                                                  |
| `pageViews`, `topPages`, `website`, `analytics` | the product's website, if it has one (as in Website below)                                                                                                                                                    |
| `haVersions`                                    | Home Assistant installs by version, or null                                                                                                                                                                   |
| `hacsVersions`                                  | `[{ version, downloads, last7 }]`: release zip downloads by tag, lifetime and last 7 days                                                                                                                     |

### Website

| Field               | Meaning                                                          |
| ------------------- | ---------------------------------------------------------------- |
| `id`, `description` | the product the site belongs to                                  |
| `line`, `family`    | its line (`family` from format 1, dropped at 1.0)                |
| `product`           | a product's site (not on an org line, not `experimental`)        |
| `analytics`         | the GoatCounter dashboard                                        |
| `daily`             | page views per day, from the first day any site counted a view   |
| `views7`, `views30` | page views over 7 and 30 days, or null before any were collected |
| `topPages`          | `[{ path, title, count }]`, last 30 days                         |

### Community project

From 0.2.0. Projects other people have built on the org's products (`community.toml`), from public
sources only. Kept apart from `components`: nothing here is added to any of the org's figures.

| Field                                                 | Meaning                                                                                   |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `id`, `name`, `url`                                   | its key in `community.toml`, the repo's name and its GitHub URL                           |
| `author`, `authorUrl`                                 | the author's GitHub login (from `author`, else the repo's owner) and profile URL          |
| `extends`                                             | the org's product it builds on, or null                                                   |
| `line`                                                | from format 2: that product's line, or its own `line`, or null                            |
| `description`, `license`, `archived`, `latestRelease` | from GitHub; `latestRelease` is `{ tag, date, url }` for the latest full release, or null |
| `channels`, `downloads`                               | as for a component                                                                        |
| `kpis.downloads7`, `kpis.downloads30`                 | all channels; null until there's a daily figure (lifetime counters need two snapshots)    |
| `kpis.totals`, `kpis.stars`, `kpis.starsChange7`      | as for a component                                                                        |
| `kpis.haInstalls`                                     | Home Assistant installs reporting today, if the project has an `ha_domain`                |
| `stars`                                               | daily series                                                                              |
