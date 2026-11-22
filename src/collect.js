// Daily snapshot of every public repo in repos.toml: <data_dir>/YYYY-MM-DD.json.
//
// Deterministic, no AI. Run it daily: GitHub keeps traffic (repo views, clones) for 14 days only, so anything
// not snapshotted is lost. Trends come from the accumulated snapshots (`hq-stats build`).
//
// Private repos are skipped entirely, not even their name is written: stats are for open source products.
//
// Tokens:
//   GITHUB_TOKEN (or GH_TOKEN, or `gh auth token`): read access to the repos, plus "Administration: read" for the
//     traffic API. Without traffic access, views and clones are recorded as errors and the rest still works.
//   GOATCOUNTER_TOKEN: an API key with "Read statistics", for repos with a `goatcounter` site code. Optional.
//
// Community projects (`[community.<id>]` with a `repo`, built on the org's products by other people) are snapshotted
// under `community`, apart from the org's own repos, from public sources only: no traffic, no page views.

import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { get, sleep } from "./http.js";

export function githubToken() {
  const env = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (env) return env;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("needs GITHUB_TOKEN (or GH_TOKEN, or a logged-in gh CLI)");
  }
}

// A failed source is recorded as { error } so one bad channel never loses the rest of the snapshot.
async function safe(fn) {
  try {
    return await fn();
  } catch (e) {
    return { error: e.message };
  }
}

async function github(org, repo, token) {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
  const base = `https://api.github.com/repos/${org}/${repo}`;
  const info = await get(base, { headers });
  if (info.private) return null;
  const releases = await get(`${base}/releases?per_page=100`, { headers });
  const traffic = async (kind) => (await get(`${base}/traffic/${kind}`, { headers }))[kind] ?? [];
  return {
    description: info.description ?? "",
    archived: Boolean(info.archived),
    stars: info.stargazers_count,
    forks: info.forks_count,
    watchers: info.subscribers_count,
    open_issues_and_prs: info.open_issues_count,
    // Daily breakdowns for the last 14 days; overlapping snapshots are de-duplicated by date in `build`.
    views: await safe(() => traffic("views")),
    clones: await safe(() => traffic("clones")),
    release_assets: Object.fromEntries(
      releases.map((r) => [r.tag_name, Object.fromEntries(r.assets.map((a) => [a.name, a.download_count]))]),
    ),
  };
}

// A community project: someone else's public repo, so only what anyone can read. Null when private.
async function communityGithub(fullName, token) {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
  const base = `https://api.github.com/repos/${fullName}`;
  const info = await get(base, { headers });
  if (info.private) return null;
  const releases = await get(`${base}/releases?per_page=100`, { headers });
  const latest = releases.find((r) => !r.draft && !r.prerelease);
  return {
    description: info.description ?? "",
    archived: Boolean(info.archived),
    license: info.license?.spdx_id ?? null,
    stars: info.stargazers_count,
    forks: info.forks_count,
    latest_release: latest ? { tag: latest.tag_name, date: latest.published_at, url: latest.html_url } : null,
    release_assets: Object.fromEntries(
      releases.map((r) => [r.tag_name, Object.fromEntries(r.assets.map((a) => [a.name, a.download_count]))]),
    ),
  };
}

// `[community.<id>]` entries that are projects (not blogs) with a GitHub repo.
export const communityProjects = (registry) =>
  Object.entries(registry.community ?? {}).filter(([, e]) => (e.kind ?? "project") === "project" && e.repo);

async function npm(pkg) {
  const q = encodeURIComponent(pkg).replace("%40", "@");
  const week = await get(`https://api.npmjs.org/downloads/point/last-week/${q}`);
  const month = await get(`https://api.npmjs.org/downloads/point/last-month/${q}`);
  return { last_week: week.downloads ?? null, last_month: month.downloads ?? null };
}

async function pypi(pkg) {
  const { data } = await get(`https://pypistats.org/api/packages/${pkg.toLowerCase()}/recent`);
  return { last_day: data.last_day, last_week: data.last_week, last_month: data.last_month };
}

// No public API for GHCR pull counts: the package page carries the lifetime total in a title attribute.
// Trends come from deltas between snapshots.
async function ghcr(org, image) {
  const html = await get(`https://github.com/${org}/${image}/pkgs/container/${image}`, { raw: true });
  const total = html.match(/Total downloads<\/span>\s*<h3 title="(\d+)"/);
  return { total: total ? Number(total[1]) : null };
}

// Page views per day for the 14 complete days before today, and the top pages of the last 30. Overlapping
// windows, like GitHub traffic, so a missed run loses nothing. GoatCounter counts one view per page per visitor
// session, bots excluded.
async function goatcounter(code, token, today) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const base = `https://${code}.goatcounter.com/api/v0/stats`;
  const day = (n) => `${addDays(today, -n)}T00:00:00Z`;
  const total = await get(`${base}/total?start=${day(14)}&end=${day(0)}`, { headers });
  await sleep(300); // GoatCounter allows 4 requests a second
  const hits = await get(`${base}/hits?start=${day(30)}&end=${day(0)}&limit=10`, { headers });
  await sleep(300);
  return {
    site: code,
    daily: Object.fromEntries((total.stats ?? []).filter((d) => d.day < today).map((d) => [d.day, d.daily])),
    top_pages_30d: (hits.hits ?? []).map((x) => ({ path: x.path, title: x.title ?? "", count: x.count })),
  };
}

export const addDays = (date, n) => new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);

// Stable output: keys sorted at every level, so a day's snapshot diffs cleanly against the last.
export function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys(value[k])]),
    );
  }
  return value;
}

export async function collect(cfg, { today = new Date().toISOString().slice(0, 10), log = console.log } = {}) {
  const { registry, org } = cfg;
  const token = githubToken();
  const gcToken = process.env.GOATCOUNTER_TOKEN;
  const haInstalls = await safe(() => get("https://analytics.home-assistant.io/custom_integrations.json"));

  const out = { collected_at: new Date().toISOString().replace(/\.\d+Z$/, "+00:00"), repos: {} };
  for (const [name, r] of Object.entries(registry.repos ?? {})) {
    const gh = await safe(() => github(org.github, name, token));
    if (gh === null) continue;
    const entry = { github: gh };
    if (r.npm) entry.npm = await safe(() => npm(r.npm));
    if (r.pypi) entry.pypi = await safe(() => pypi(r.pypi));
    if (r.ghcr) entry.ghcr = await safe(() => ghcr(org.github, r.ghcr));
    if (r.ha_domain && !haInstalls.error) entry.ha_installs = haInstalls[r.ha_domain]?.total ?? null;
    if (r.goatcounter) {
      entry.goatcounter = gcToken ? await safe(() => goatcounter(r.goatcounter, gcToken, today)) : { error: "no GOATCOUNTER_TOKEN" };
    }
    out.repos[name] = entry;
  }

  const community = communityProjects(registry);
  if (community.length) out.community = {};
  for (const [id, e] of community) {
    const gh = await safe(() => communityGithub(e.repo, token));
    if (gh === null) continue;
    const entry = { github: gh };
    if (e.npm) entry.npm = await safe(() => npm(e.npm));
    if (e.pypi) entry.pypi = await safe(() => pypi(e.pypi));
    if (e.ghcr) entry.ghcr = await safe(() => ghcr(e.repo.split("/")[0], e.ghcr));
    if (e.ha_domain && !haInstalls.error) entry.ha_installs = haInstalls[e.ha_domain]?.total ?? null;
    out.community[id] = entry;
  }

  const dest = path.join(cfg.dataDir, `${today}.json`);
  await mkdir(cfg.dataDir, { recursive: true });
  await writeFile(dest, `${JSON.stringify(sortKeys(out), null, 1)}\n`);
  const sections = [...Object.entries(out.repos), ...Object.entries(out.community ?? {}).map(([n, e]) => [`community.${n}`, e])];
  const errors = sections.flatMap(([n, e]) =>
    Object.entries(e).flatMap(([k, v]) => [
      ...(v?.error ? [`${n}.${k}`] : []),
      ...(k === "github" ? ["views", "clones"].filter((t) => v?.[t]?.error).map((t) => `${n}.github.${t}`) : []),
    ]),
  );
  const shown = path.relative(process.cwd(), dest);
  log(`wrote ${shown.startsWith("..") ? dest : shown}${errors.length ? `; errors: ${errors.join(", ")}` : ""}`);
  return { dest, snapshot: out, errors };
}
