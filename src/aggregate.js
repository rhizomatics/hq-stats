// The public aggregate (stats.json) behind the Usage pages, from the daily snapshots plus live public APIs.
//
// Sources, all read-only:
//   - <data_dir>/YYYY-MM-DD.json   daily snapshots by `hq-stats collect`
//   - the config                   which products to cover (archived and non-public ones left out), and their repos
//   - [stats] legacy_hacs          optional history from the retired hacs-downloads site
//   - live public APIs: npm daily downloads, PyPI daily downloads, Home Assistant analytics by version
//
// Snapshots are keyed by repo; everything here is per product, its repos' entries put together (`byProduct`).
//
// Community projects go in their own `community` list, never in `components` or any total.
//
// The format is documented in docs/data-format.md. Everything in it is public: snapshots only ever hold public
// repos, and this keeps to aggregates (downloads, stars, GitHub traffic counts, HA installs, page views).

import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { get } from "./http.js";
import { addDays, communityProjects, npmPath } from "./collect.js";
import { channels, isOrgLine } from "./config.js";

// 2 from 0.3.0: components, websites and community projects gain `line` (and components `repos`); `family` stays,
// with the same value as `line`, until 1.0.
export const FORMAT_VERSION = 2;
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

// A renamed repo (a product's `formerly.name`) is read under its current name from snapshots and legacy history
// made before the rename; a community project's, under its id.
export function applyRenames(cfg, snapshots, legacy) {
  const move = (group, pairs) => {
    for (const [old, name] of pairs) if (group?.[old] && !group[name]) group[name] = group[old];
  };
  const repos = cfg.products.flatMap((p) => p.formerly.name.map((old) => [old, p.repos[0]]));
  const community = cfg.community.flatMap((e) => e.formerly.name.map((old) => [old, e.id]));
  for (const s of snapshots) {
    move(s.repos, repos);
    move(s.community, community);
  }
  for (const projects of Object.values(legacy)) move(projects, repos);
}

// GitHub traffic lists from several repos, summed by day.
function mergeTraffic(lists) {
  const byDay = {};
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const c of list) {
      const t = (byDay[c.timestamp] ??= { timestamp: c.timestamp, count: 0, uniques: 0 });
      t.count += c.count;
      t.uniques += c.uniques;
    }
  }
  return Object.values(byDay).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

// A product's snapshot entry: its repos' entries put together. A single repo (the usual case) is used as it is;
// several have their GitHub counts summed and release assets merged, and channels come from whichever repo has them
// (the collector puts them on the first public one).
export function mergeRepos(entries) {
  if (entries.length <= 1) return entries[0];
  const merged = Object.assign({}, ...[...entries].reverse());
  const ghs = entries.map((e) => e.github).filter((g) => g && !g.error);
  if (ghs.length > 1) {
    const sum = (k) => ghs.reduce((n, g) => n + (g[k] ?? 0), 0);
    const assets = {};
    for (const g of ghs) {
      if (!g.release_assets || g.release_assets.error) continue;
      for (const [tag, a] of Object.entries(g.release_assets)) assets[tag] = { ...assets[tag], ...a };
    }
    merged.github = {
      ...ghs[0],
      archived: ghs.every((g) => g.archived),
      stars: sum("stars"),
      forks: sum("forks"),
      watchers: sum("watchers"),
      open_issues_and_prs: sum("open_issues_and_prs"),
      views: mergeTraffic(ghs.map((g) => g.views)),
      clones: mergeTraffic(ghs.map((g) => g.clones)),
      release_assets: assets,
    };
  } else if (ghs.length) merged.github = ghs[0];
  return merged;
}

// Snapshots re-keyed by product id; legacy history (keyed by repo) likewise.
export function byProduct(products, snapshots, legacy = {}) {
  const view = snapshots.map((s) => ({
    date: s.date,
    repos: Object.fromEntries(
      products.map((p) => [p.id, mergeRepos(p.repos.map((r) => s.repos?.[r]).filter(Boolean))]).filter(([, e]) => e),
    ),
  }));
  const legacyView = Object.fromEntries(
    Object.entries(legacy).map(([date, projects]) => [
      date,
      Object.fromEntries(
        products.map((p) => [p.id, legacyProject(projects, p.id) ?? legacyProject(projects, p.repos[0])]).filter(([, e]) => e),
      ),
    ]),
  );
  return { view, legacyView };
}

// Daily figures summed across a package's current and former names.
async function dailyAcross(fetch, names) {
  const out = {};
  for (const series of await Promise.all(names.map(fetch))) {
    for (const [d, v] of Object.entries(series)) out[d] = (out[d] ?? 0) + v;
  }
  return out;
}

// Home Assistant installs today across an integration's current and former domains; versions are the current one's.
function haLiveFor(haLive, domains) {
  const found = domains.map((d) => haLive?.[d]).filter(Boolean);
  if (!found.length) return null;
  return { ...found[0], total: found.reduce((s, x) => s + (x.total ?? 0), 0) };
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
  const data = await get(`https://api.npmjs.org/downloads/range/${start}:${end}/${npmPath(pkg)}`);
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

// A release's HACS downloads: its asset under the current `hacs_zip` name or any former one.
const zipCount = (assets, zips) => zips.reduce((sum, z) => sum + (assets?.[z] ?? 0), 0);

function hacsPoints(snapshots, legacy, repo, zips) {
  const points = {};
  for (const [date, projects] of Object.entries(legacy)) {
    const total = legacyProject(projects, repo)?.total;
    if (Number.isFinite(total)) points[date] = total;
  }
  for (const s of snapshots) {
    const assets = s.repos[repo]?.github?.release_assets;
    if (!assets || assets.error) continue;
    points[s.date] = Object.values(assets).reduce((sum, a) => sum + zipCount(a, zips), 0);
  }
  return fromBaseline(Object.entries(points).sort((a, b) => a[0].localeCompare(b[0])));
}

function hacsVersions(snapshots, repo, zips) {
  const withAssets = snapshots.filter((s) => s.repos[repo]?.github?.release_assets && !s.repos[repo].github.release_assets.error);
  const latest = withAssets.at(-1);
  if (!latest) return [];
  const weekAgo = [...withAssets].reverse().find((s) => s.date <= addDays(latest.date, -7));
  return Object.entries(latest.repos[repo].github.release_assets)
    .filter(([, a]) => zips.some((z) => z in a))
    .map(([tag, a]) => {
      const downloads = zipCount(a, zips);
      const before = zipCount(weekAgo?.repos[repo].github.release_assets[tag], zips);
      return { version: tag, downloads, last7: weekAgo ? downloads - before : null };
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
// record them), else the config's own `description`.
function repoMeta(snapshots, name, product) {
  const latest = [...snapshots].reverse().find((s) => s.repos[name]?.github && !s.repos[name].github.error);
  const gh = latest?.repos[name].github;
  return { description: gh?.description || product.description || "", archived: Boolean(gh?.archived) };
}

function sumChannels(downloads) {
  const all = {};
  for (const series of Object.values(downloads)) {
    for (const [d, v] of Object.entries(series)) all[d] = (all[d] ?? 0) + v;
  }
  return all;
}

// Community projects: other people's public projects built on the org's products. Built from their own section of
// the snapshots, so nothing here is ever added to the org's components or totals.
async function buildCommunity({ cfg, snapshots, live, haLive, notes, today }) {
  const entries = communityProjects(cfg);
  // The community section, shaped like the repos section so the same series helpers read it.
  const snaps = snapshots.map((s) => ({ date: s.date, repos: s.community ?? {} }));
  const latest = snaps.at(-1);
  const out = [];
  for (const e of entries) {
    const { id } = e;
    const ch = channels(e);
    const gh = latest.repos[id]?.github;
    if (!gh) continue; // not public, or not collected yet
    if (gh.error) {
      notes.push(`Community project ${id} unavailable in the latest snapshot.`);
      continue;
    }
    const { downloads, totals, fallback } = await channelDownloads({
      name: id,
      ch,
      snapshots: snaps,
      legacy: {},
      latest,
      live,
      notes,
    });
    const all = sumChannels(downloads);
    const counted = Object.keys(all).length > 0 || fallback.d30 > 0;
    const stars = seriesFromSnapshots(snaps, {}, id, (r) => r?.github?.stars);
    const starWeekAgo = valueDaysAgo(stars, 7, today);
    const haToday = ch.haDomains.length ? haLiveFor(haLive, ch.haDomains) : null;
    const [owner, repoName] = e.repo.split("/");
    out.push({
      id,
      name: repoName,
      url: `https://github.com/${e.repo}`,
      author: e.author ?? owner,
      authorUrl: `https://github.com/${e.author ?? owner}`,
      extends: e.extends,
      line: e.line,
      description: gh.description ?? "",
      license: gh.license ?? null,
      archived: Boolean(gh.archived),
      latestRelease: gh.latest_release ?? null,
      channels: Object.keys(downloads),
      kpis: {
        // Null until there's a daily figure: a project's first snapshot is only a baseline for lifetime counters.
        downloads7: counted ? sumRecent(all, 7, today) + fallback.d7 : null,
        downloads30: counted ? sumRecent(all, 30, today) + fallback.d30 : null,
        totals,
        stars: gh.stars ?? null,
        starsChange7: gh.stars != null && starWeekAgo != null ? gh.stars - starWeekAgo : null,
        haInstalls: haToday?.total ?? latest.repos[id]?.ha_installs ?? null,
      },
      downloads,
      stars,
    });
  }
  return out.sort((a, b) => (a.extends ?? "").localeCompare(b.extends ?? "") || a.name.localeCompare(b.name));
}

// Daily downloads per channel for one repo (or community project), lifetime totals where known, and the 7- and
// 30-day figures from the latest snapshot for any live source that failed.
async function channelDownloads({ name, ch, snapshots, legacy, latest, live, notes }) {
  const downloads = {};
  const totals = {};
  // When a live source fails, its 7- and 30-day totals still come from the latest snapshot.
  const fallback = { d7: 0, d30: 0 };
  const fallBackTo = (key) => {
    const recent = latest.repos[name]?.[key];
    if (Number.isFinite(recent?.last_week)) fallback.d7 += recent.last_week;
    if (Number.isFinite(recent?.last_month)) fallback.d30 += recent.last_month;
  };
  if (ch.hacs.length) {
    const points = hacsPoints(snapshots, legacy, name, ch.hacs);
    downloads.hacs = cumulativeToDaily(points);
    totals.hacs = points.at(-1)?.[1] ?? null;
  }
  if (ch.npm.length && live) {
    try {
      downloads.npm = await dailyAcross(npmDaily, ch.npm);
      totals.npm = Object.values(downloads.npm).reduce((a, b) => a + b, 0);
    } catch (e) {
      notes.push(`npm daily downloads for ${name} unavailable at build (${e.message}).`);
      fallBackTo("npm");
    }
  } else if (ch.npm.length) fallBackTo("npm");
  if (ch.pypi.length && live) {
    try {
      downloads.pypi = await dailyAcross(pypiDaily, ch.pypi);
    } catch (e) {
      notes.push(`PyPI daily downloads for ${name} unavailable at build (${e.message}).`);
      fallBackTo("pypi");
    }
  } else if (ch.pypi.length) fallBackTo("pypi");
  if (ch.ghcr.length) {
    const points = ghcrPoints(snapshots, name);
    downloads.ghcr = cumulativeToDaily(points);
    totals.ghcr = points.at(-1)?.[1] ?? null;
  }

  return { downloads, totals, fallback };
}

export async function aggregate(cfg, { log = console.log, warn = console.warn, live = true } = {}) {
  const { org } = cfg;
  const [raw, rawLegacy] = await Promise.all([loadSnapshots(cfg.dataDir), loadLegacy(cfg.legacyPath)]);
  applyRenames(cfg, raw, rawLegacy);
  const { view: snapshots, legacyView: legacy } = byProduct(cfg.products, raw, rawLegacy);
  const latest = snapshots.at(-1);
  const latestRaw = raw.at(-1);
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

  for (const p of cfg.products) {
    const name = p.id;
    // In the latest snapshot means public (the collector skips private repos).
    if (p.lifecycle === "archived" || !p.public || !latest.repos[name]) continue;
    const meta = repoMeta(snapshots, name, p);
    if (meta.archived) continue;
    const ch = channels(p);
    const orgLine = isOrgLine(cfg, p.line);
    const repos = p.repos.filter((r) => latestRaw.repos[r]);

    const views = ch.goatcounter ? pageViews(snapshots, name) : {};
    const analytics = ch.goatcounter ? `https://${String(ch.goatcounter)}.goatcounter.com/` : null;
    if (ch.goatcounter) {
      if (latest.repos[name]?.goatcounter?.error) notes.push(`Page views for ${name} unavailable in the latest snapshot.`);
      websites.push({
        id: name,
        line: p.line,
        family: p.line,
        product: !orgLine && p.lifecycle === "active",
        description: meta.description,
        analytics,
        daily: views,
        views7: Object.keys(views).length ? sumRecent(views, 7, today) : null,
        views30: Object.keys(views).length ? sumRecent(views, 30, today) : null,
        topPages: topPages(snapshots, name),
      });
    }
    if (orgLine) continue;

    const { downloads, totals, fallback } = await channelDownloads({ name, ch, snapshots, legacy, latest, live, notes });

    const stars = seriesFromSnapshots(
      snapshots,
      legacy,
      name,
      (r) => r?.github?.stars,
      (l) => l?.stars,
    );
    const haInstalls = ch.haDomains.length
      ? seriesFromSnapshots(
          snapshots,
          legacy,
          name,
          (r) => r?.ha_installs,
          (l) => l?.haAnalytics?.total,
        )
      : {};
    const haToday = ch.haDomains.length ? haLiveFor(haLive, ch.haDomains) : null;
    if (haToday) haInstalls[isoDate(Date.now())] = haToday.total;
    const lastLegacyHa = Object.values(legacy)
      .map((l) => legacyProject(l, name)?.haAnalytics)
      .filter(Boolean)
      .at(-1);
    const haVersions = haToday?.versions ?? lastLegacyHa?.versions ?? null;

    const allDaily = sumChannels(downloads);
    const cloneSeries = traffic(snapshots, legacy, name, "clones");
    const repoViewSeries = traffic(snapshots, legacy, name, "views");
    const last14 = (series) =>
      Object.entries(series)
        .filter(([d]) => d > addDays(today, -14))
        .reduce((n, [, c]) => n + c.count, 0);
    const latestOf = (series) =>
      Object.entries(series)
        .sort(([a], [b]) => a.localeCompare(b))
        .at(-1)?.[1] ?? null;
    const starNow = latestOf(stars);
    const starWeekAgo = valueDaysAgo(stars, 7, today);
    const site = websites.at(-1)?.id === name ? websites.at(-1) : null;

    components.push({
      id: name,
      line: p.line,
      family: p.line,
      repos,
      description: meta.description,
      url: `https://github.com/${org.github}/${repos[0] ?? p.repos[0]}`,
      major: p.significance === "major",
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
      topPages: ch.goatcounter ? topPages(snapshots, name) : [],
      website: Boolean(ch.goatcounter),
      analytics,
      stars,
      clones: cloneSeries,
      repoViews: repoViewSeries,
      haInstalls,
      haVersions,
      hacsVersions: ch.hacs.length ? hacsVersions(snapshots, name, ch.hacs) : [],
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

  const community = await buildCommunity({ cfg, snapshots: raw, live, haLive, notes, today });

  const stats = {
    format: FORMAT_VERSION,
    generatedAt: new Date().toISOString(),
    org: { name: org.name, github: org.github },
    snapshotDate: today,
    firstSnapshot: [...Object.keys(rawLegacy), snapshots[0].date].sort((a, b) => a.localeCompare(b))[0],
    // The first snapshot that read page views from GoatCounter (null until one has).
    pageViewsSince: raw.find((s) => Object.values(s.repos).some((r) => r.goatcounter?.daily))?.date ?? null,
    notes,
    components,
    websites,
    community,
  };
  await mkdir(path.dirname(cfg.outPath), { recursive: true });
  await writeFile(cfg.outPath, `${JSON.stringify(stats)}\n`);
  log(
    `stats: ${components.length} components, ${websites.length} websites (${websites.filter((w) => w.views30 != null).length} with page views), ${community.length} community projects, snapshot ${today}${notes.length ? `; ${notes.length} source gaps` : ""}`,
  );
  for (const n of notes) warn(`  ${n}`);
  return stats;
}
