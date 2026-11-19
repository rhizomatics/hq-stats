// The public aggregate (stats.json) behind the Usage pages, from the daily snapshots plus live public APIs.
//
// Sources, all read-only:
//   - <data_dir>/YYYY-MM-DD.json   daily snapshots by `hq-stats collect`
//   - repos.toml                   which repos to cover (`archived = true`, `internal` ones left out)
//   - [stats] legacy_hacs          optional history from the retired hacs-downloads site
//   - live public APIs: npm daily downloads, PyPI daily downloads, Home Assistant analytics by version
//
// The format is documented in docs/data-format.md. Everything in it is public: snapshots only ever hold public
// repos, and this keeps to aggregates (downloads, stars, GitHub traffic counts, HA installs, page views).

import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { get } from "./http.js";
import { addDays } from "./collect.js";

export const FORMAT_VERSION = 1;
const DAY = 86_400_000;
const isoDate = (t) => new Date(t).toISOString().slice(0, 10);

// hacs-downloads keyed some projects by a hyphenated id rather than the repo name.
const legacyProject = (projects, repo) => projects?.[repo] ?? projects?.[repo.replace(/_/g, "-")];

// Daily values from a cumulative counter sampled on irregular dates. A gap of n days is spread evenly over those
// days; a drop (asset replaced or deleted, counter reset) counts as zero.
export function cumulativeToDaily(points) {
  const daily = {};
  const sorted = [...points].sort((a, b) => a[0].localeCompare(b[0]));
  for (let i = 1; i < sorted.length; i += 1) {
    const [prevDate, prev] = sorted[i - 1];
    const [date, value] = sorted[i];
    const days = Math.round((Date.parse(date) - Date.parse(prevDate)) / DAY);
    if (days < 1) continue;
    const delta = Math.max(0, value - prev);
    for (let d = 0; d < days; d += 1) {
      const day = addDays(prevDate, d + 1);
      daily[day] = (daily[day] ?? 0) + delta / days;
    }
  }
  return Object.fromEntries(Object.entries(daily).map(([d, v]) => [d, Math.round(v * 10) / 10]));
}

// A counter that first appears mid-history jumps from near zero to its lifetime total in one step. That step is a
// baseline, not a day's downloads, so the series starts at the last such jump.
export function fromBaseline(sorted) {
  let start = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    const [, prev] = sorted[i - 1];
    const [, value] = sorted[i];
    if (value > 50 && prev < value * 0.05) start = i;
  }
  return sorted.slice(start);
}

// GitHub keeps 14 days of traffic; every snapshot has an overlapping window. The latest snapshot to mention a day
// wins, except its own day, which can be partial. Only clones have legacy history.
export function traffic(snapshots, legacy, repo, kind) {
  const out = {};
  for (const projects of Object.values(legacy)) {
    for (const c of legacyProject(projects, repo)?.[kind] ?? []) out[c.date] = { count: c.count, uniques: c.uniques };
  }
  for (const s of snapshots) {
    const list = s.repos[repo]?.github?.[kind];
    if (!Array.isArray(list)) continue;
    for (const c of list) {
      const date = c.timestamp.slice(0, 10);
      if (date >= s.date) continue;
      out[date] = { count: c.count, uniques: c.uniques };
    }
  }
  return out;
}

export const sumRecent = (daily, days, today) => {
  const from = addDays(today, -days);
  return Math.round(
    Object.entries(daily)
      .filter(([d]) => d > from && d <= today)
      .reduce((s, [, v]) => s + v, 0),
  );
};

const valueDaysAgo = (series, days, today) => {
  const target = addDays(today, -days);
  const dates = Object.keys(series)
    .filter((d) => d <= target)
    .sort();
  return dates.length ? series[dates.at(-1)] : null;
};

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export async function loadSnapshots(dir) {
  const files = (await readdir(dir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (!files.length) throw new Error(`no snapshots in ${dir}: run \`hq-stats collect\` first`);
  return Promise.all(files.map(async (f) => ({ date: f.slice(0, 10), ...(await readJson(path.join(dir, f))) })));
}

async function loadLegacy(file) {
  if (!file) return {};
  try {
    const history = await readJson(file);
    const byDate = {};
    for (const s of history.snapshots) byDate[s.capturedAt.slice(0, 10)] = { ...byDate[s.capturedAt.slice(0, 10)], ...s.projects };
    return byDate;
  } catch {
    return {};
  }
}

async function npmDaily(pkg) {
  const end = isoDate(Date.now() - DAY);
  const start = addDays(end, -540); // npm's range API allows up to 18 months
  const data = await get(`https://api.npmjs.org/downloads/range/${start}:${end}/${encodeURIComponent(pkg).replace("%40", "@")}`);
  const daily = {};
  let seen = false;
  for (const { day, downloads } of data.downloads) {
    seen ||= downloads > 0;
    if (seen) daily[day] = downloads; // drop the run of zeros before the first publish
  }
  return daily;
}

async function pypiDaily(pkg) {
  const data = await get(`https://pypistats.org/api/packages/${pkg.toLowerCase()}/overall?mirrors=false`);
  const daily = {};
  for (const row of data.data) if (row.category === "without_mirrors") daily[row.date] = row.downloads;
  return daily;
}

const ghcrPoints = (snapshots, repo) => snapshots.map((s) => [s.date, s.repos[repo]?.ghcr?.total]).filter(([, v]) => Number.isFinite(v));

function hacsPoints(snapshots, legacy, repo, zip) {
  const points = {};
  for (const [date, projects] of Object.entries(legacy)) {
    const total = legacyProject(projects, repo)?.total;
    if (Number.isFinite(total)) points[date] = total;
  }
  for (const s of snapshots) {
    const assets = s.repos[repo]?.github?.release_assets;
    if (!assets || assets.error) continue;
    points[s.date] = Object.values(assets).reduce((sum, a) => sum + (a[zip] ?? 0), 0);
  }
  return fromBaseline(Object.entries(points).sort((a, b) => a[0].localeCompare(b[0])));
}

function hacsVersions(snapshots, repo, zip) {
  const withAssets = snapshots.filter((s) => s.repos[repo]?.github?.release_assets && !s.repos[repo].github.release_assets.error);
  const latest = withAssets.at(-1);
  if (!latest) return [];
  const weekAgo = [...withAssets].reverse().find((s) => s.date <= addDays(latest.date, -7));
  return Object.entries(latest.repos[repo].github.release_assets)
    .filter(([, a]) => zip in a)
    .map(([tag, a]) => {
      const before = weekAgo?.repos[repo].github.release_assets[tag]?.[zip];
      return { version: tag, downloads: a[zip], last7: weekAgo ? a[zip] - (before ?? 0) : null };
    });
}

function seriesFromSnapshots(snapshots, legacy, repo, pick, legacyPick) {
  const out = {};
  for (const [date, projects] of Object.entries(legacy)) {
    const v = legacyPick?.(legacyProject(projects, repo));
    if (Number.isFinite(v)) out[date] = v;
  }
  for (const s of snapshots) {
    const v = pick(s.repos[repo]);
    if (Number.isFinite(v)) out[s.date] = v;
  }
  return out;
}

// GoatCounter page views per day. Each snapshot holds the 14 complete days before it; the latest to mention a day wins.
function pageViews(snapshots, repo) {
  const out = {};
  for (const s of snapshots) {
    const daily = s.repos[repo]?.goatcounter?.daily;
    if (daily && typeof daily === "object") Object.assign(out, daily);
  }
  return out;
}

function topPages(snapshots, repo) {
  const latest = [...snapshots].reverse().find((s) => Array.isArray(s.repos[repo]?.goatcounter?.top_pages_30d));
  return latest ? latest.repos[repo].goatcounter.top_pages_30d.map(({ path: p, title, count }) => ({ path: p, title, count })) : [];
}

// Description and archive state come from the latest snapshot that has them (collectors before 0.1.0 didn't
// record them), else repos.toml's own `description`.
function repoMeta(snapshots, name, repo) {
  const latest = [...snapshots].reverse().find((s) => s.repos[name]?.github && !s.repos[name].github.error);
  const gh = latest?.repos[name].github;
  return { description: gh?.description ?? repo.description ?? "", archived: Boolean(gh?.archived) };
}

export async function aggregate(cfg, { log = console.log, warn = console.warn, live = true } = {}) {
  const { registry, org } = cfg;
  const [snapshots, legacy] = await Promise.all([loadSnapshots(cfg.dataDir), loadLegacy(cfg.legacyPath)]);
  const latest = snapshots.at(-1);
  const haLive = live
    ? await get("https://analytics.home-assistant.io/custom_integrations.json").catch((e) => {
        warn(`Home Assistant analytics unavailable: ${e.message}`);
        return null;
      })
    : null;
  const today = latest.date;
  const notes = [];
  const components = [];
  const websites = [];

  for (const [name, repo] of Object.entries(registry.repos ?? {})) {
    // In the latest snapshot means public (the collector skips private repos).
    if (repo.archived || repo.category?.includes("internal") || !latest.repos[name]) continue;
    const meta = repoMeta(snapshots, name, repo);
    if (meta.archived) continue;

    const views = repo.goatcounter ? pageViews(snapshots, name) : {};
    const product = repo.family !== "meta" && !repo.category?.includes("experimental");
    if (repo.goatcounter) {
      if (latest.repos[name]?.goatcounter?.error) notes.push(`Page views for ${name} unavailable in the latest snapshot.`);
      websites.push({
        id: name,
        family: repo.family ?? null,
        product,
        description: meta.description,
        analytics: `https://${repo.goatcounter}.goatcounter.com/`,
        daily: views,
        views7: Object.keys(views).length ? sumRecent(views, 7, today) : null,
        views30: Object.keys(views).length ? sumRecent(views, 30, today) : null,
        topPages: topPages(snapshots, name),
      });
    }
    if (repo.family === "meta") continue;

    const downloads = {};
    const totals = {};
    // When a live source fails, its 7- and 30-day totals still come from the latest snapshot.
    const fallback = { d7: 0, d30: 0 };
    const fallBackTo = (key) => {
      const recent = latest.repos[name]?.[key];
      if (Number.isFinite(recent?.last_week)) fallback.d7 += recent.last_week;
      if (Number.isFinite(recent?.last_month)) fallback.d30 += recent.last_month;
    };
    if (repo.hacs_zip) {
      const points = hacsPoints(snapshots, legacy, name, repo.hacs_zip);
      downloads.hacs = cumulativeToDaily(points);
      totals.hacs = points.at(-1)?.[1] ?? null;
    }
    if (repo.npm && live) {
      try {
        downloads.npm = await npmDaily(repo.npm);
        totals.npm = Object.values(downloads.npm).reduce((a, b) => a + b, 0);
      } catch (e) {
        notes.push(`npm daily downloads for ${name} unavailable at build (${e.message}).`);
        fallBackTo("npm");
      }
    } else if (repo.npm) fallBackTo("npm");
    if (repo.pypi && live) {
      try {
        downloads.pypi = await pypiDaily(repo.pypi);
      } catch (e) {
        notes.push(`PyPI daily downloads for ${name} unavailable at build (${e.message}).`);
        fallBackTo("pypi");
      }
    } else if (repo.pypi) fallBackTo("pypi");
    if (repo.ghcr) {
      const points = ghcrPoints(snapshots, name);
      downloads.ghcr = cumulativeToDaily(points);
      totals.ghcr = points.at(-1)?.[1] ?? null;
    }

    const stars = seriesFromSnapshots(
      snapshots,
      legacy,
      name,
      (r) => r?.github?.stars,
      (p) => p?.stars,
    );
    const haInstalls = repo.ha_domain
      ? seriesFromSnapshots(
          snapshots,
          legacy,
          name,
          (r) => r?.ha_installs,
          (p) => p?.haAnalytics?.total,
        )
      : {};
    const haToday = repo.ha_domain && haLive ? haLive[repo.ha_domain] : null;
    if (haToday) haInstalls[isoDate(Date.now())] = haToday.total;
    const lastLegacyHa = Object.values(legacy)
      .map((p) => legacyProject(p, name)?.haAnalytics)
      .filter(Boolean)
      .at(-1);
    const haVersions = haToday?.versions ?? lastLegacyHa?.versions ?? null;

    const allDaily = {};
    for (const series of Object.values(downloads)) {
      for (const [d, v] of Object.entries(series)) allDaily[d] = (allDaily[d] ?? 0) + v;
    }
    const cloneSeries = traffic(snapshots, legacy, name, "clones");
    const repoViewSeries = traffic(snapshots, legacy, name, "views");
    const last14 = (series) =>
      Object.entries(series)
        .filter(([d]) => d > addDays(today, -14))
        .reduce((s, [, c]) => s + c.count, 0);
    const latestOf = (series) =>
      Object.entries(series)
        .sort(([a], [b]) => a.localeCompare(b))
        .at(-1)?.[1] ?? null;
    const starNow = latestOf(stars);
    const starWeekAgo = valueDaysAgo(stars, 7, today);
    const site = websites.at(-1)?.id === name ? websites.at(-1) : null;

    components.push({
      id: name,
      family: repo.family ?? null,
      description: meta.description,
      url: `https://github.com/${org.github}/${name}`,
      major: Boolean(repo.category?.includes("major")),
      channels: Object.keys(downloads),
      kpis: {
        downloads7: sumRecent(allDaily, 7, today) + fallback.d7,
        downloads30: sumRecent(allDaily, 30, today) + fallback.d30,
        totals,
        stars: starNow,
        starsChange7: starNow != null && starWeekAgo != null ? starNow - starWeekAgo : null,
        haInstalls: haToday?.total ?? latestOf(haInstalls),
        views7: site ? site.views7 : null,
        views30: site ? site.views30 : null,
        clones14: last14(cloneSeries),
        repoViews14: last14(repoViewSeries),
      },
      downloads,
      pageViews: views,
      topPages: repo.goatcounter ? topPages(snapshots, name) : [],
      website: Boolean(repo.goatcounter),
      analytics: repo.goatcounter ? `https://${repo.goatcounter}.goatcounter.com/` : null,
      stars,
      clones: cloneSeries,
      repoViews: repoViewSeries,
      haInstalls,
      haVersions,
      hacsVersions: repo.hacs_zip ? hacsVersions(snapshots, name, repo.hacs_zip) : [],
    });
  }

  // GoatCounter reports a zero for every day in its window, including those before a site started counting. Drop
  // the days before any site counted a view, so charts start when counting did. Each site's daily is the same object
  // as its component's pageViews, so this trims both.
  const pageViewsFrom = websites
    .flatMap((w) =>
      Object.entries(w.daily)
        .filter(([, n]) => n > 0)
        .map(([d]) => d),
    )
    .sort()[0];
  for (const w of websites) {
    for (const d of Object.keys(w.daily)) if (!pageViewsFrom || d < pageViewsFrom) delete w.daily[d];
  }

  const stats = {
    format: FORMAT_VERSION,
    generatedAt: new Date().toISOString(),
    org: { name: org.name, github: org.github },
    snapshotDate: today,
    firstSnapshot: [...Object.keys(legacy), snapshots[0].date].sort((a, b) => a.localeCompare(b))[0],
    // The first snapshot that read page views from GoatCounter (null until one has).
    pageViewsSince: snapshots.find((s) => Object.values(s.repos).some((r) => r.goatcounter?.daily))?.date ?? null,
    notes,
    components,
    websites,
  };
  await mkdir(path.dirname(cfg.outPath), { recursive: true });
  await writeFile(cfg.outPath, `${JSON.stringify(stats)}\n`);
  log(
    `stats: ${components.length} components, ${websites.length} websites (${websites.filter((w) => w.views30 != null).length} with page views), snapshot ${today}${notes.length ? `; ${notes.length} source gaps` : ""}`,
  );
  for (const n of notes) warn(`  ${n}`);
  return stats;
}
