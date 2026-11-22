import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { aggregate, cumulativeToDaily, fromBaseline, sumRecent, traffic } from "../src/aggregate.js";
import { sortKeys } from "../src/collect.js";
import { families, loadConfig } from "../src/config.js";
import { usageSidebar } from "../src/astro/sidebar.js";

test("cumulativeToDaily spreads a gap evenly and treats a drop as zero", () => {
  const daily = cumulativeToDaily([
    ["2026-01-01", 10],
    ["2026-01-04", 16],
    ["2026-01-05", 4],
  ]);
  assert.deepEqual(daily, { "2026-01-02": 2, "2026-01-03": 2, "2026-01-04": 2, "2026-01-05": 0 });
});

test("fromBaseline starts after a counter appears with its lifetime total", () => {
  const pts = [
    ["2026-01-01", 0],
    ["2026-01-02", 1],
    ["2026-01-03", 900],
    ["2026-01-04", 905],
  ];
  assert.deepEqual(fromBaseline(pts), pts.slice(2));
});

test("traffic: the latest snapshot wins, its own (partial) day is ignored", () => {
  const day = (d, count) => ({ timestamp: `${d}T00:00:00Z`, count, uniques: 1 });
  const snapshots = [
    { date: "2026-01-03", repos: { r: { github: { views: [day("2026-01-02", 5), day("2026-01-03", 1)] } } } },
    { date: "2026-01-04", repos: { r: { github: { views: [day("2026-01-02", 6), day("2026-01-03", 7), day("2026-01-04", 1)] } } } },
  ];
  assert.deepEqual(traffic(snapshots, {}, "r", "views"), {
    "2026-01-02": { count: 6, uniques: 1 },
    "2026-01-03": { count: 7, uniques: 1 },
  });
});

test("sumRecent counts the n days up to and including today", () => {
  assert.equal(sumRecent({ "2026-01-01": 1, "2026-01-02": 2, "2026-01-08": 4 }, 7, "2026-01-08"), 6);
});

test("sortKeys orders keys at every level", () => {
  assert.equal(JSON.stringify(sortKeys({ b: 1, a: { d: [{ z: 1, y: 2 }], c: 2 } })), '{"a":{"c":2,"d":[{"y":2,"z":1}]},"b":1}');
});

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "hq-stats-"));
  await writeFile(
    path.join(dir, "repos.toml"),
    `[org]
name = "Example"
github = "example"

[stats]
data_dir = "data/stats"

[families]
tool = { label = "Tools" }
meta = { label = "Us" }

[repos.widget]
family = "tool"
hacs_zip = "widget.zip"
ghcr = "widget"
goatcounter = "widget"

[repos.www]
family = "meta"
goatcounter = "www"

[repos.gone]
family = "tool"
archived = true

[repos.secret]
family = "tool"

[community.widget-card]
repo = "someone/widget-card"
author = "someone"
extends = "widget"
hacs_zip = "card.js"

[community.blog]
kind = "blog"
url = "https://blog.example.org"
`,
  );
  const snap = (date, zip, pulls, views) => ({
    collected_at: `${date}T05:00:00+00:00`,
    repos: {
      widget: {
        github: {
          description: "A widget",
          archived: false,
          stars: 3,
          views: [{ timestamp: `${date}T00:00:00Z`, count: 1, uniques: 1 }],
          clones: [],
          release_assets: { "v1.0.0": { "widget.zip": zip } },
        },
        ghcr: { total: pulls },
        goatcounter: { site: "widget", daily: views, top_pages_30d: [{ path: "/", title: "Home", count: 9 }] },
      },
      www: { github: { stars: 0, views: [], clones: [], release_assets: {} }, goatcounter: { site: "www", daily: {}, top_pages_30d: [] } },
      gone: { github: { stars: 0, views: [], clones: [], release_assets: {} } },
    },
    community: {
      "widget-card": {
        github: {
          description: "A card",
          archived: false,
          license: "MIT",
          stars: zip,
          forks: 0,
          latest_release: { tag: "v2", date: `${date}T00:00:00Z`, url: "https://github.com/someone/widget-card/releases/v2" },
          release_assets: { v2: { "card.js": zip * 10 } },
        },
      },
    },
  });
  await mkdir(path.join(dir, "data", "stats"), { recursive: true });
  await writeFile(path.join(dir, "data", "stats", "2026-01-01.json"), JSON.stringify(snap("2026-01-01", 10, 100, { "2025-12-31": 0 })));
  await writeFile(
    path.join(dir, "data", "stats", "2026-01-03.json"),
    JSON.stringify(snap("2026-01-03", 14, 106, { "2026-01-01": 2, "2026-01-02": 3 })),
  );
  return dir;
}

test("build: public, unarchived repos only; downloads, page views and totals from snapshots", async () => {
  const dir = await fixture();
  const cfg = loadConfig({ config: path.join(dir, "repos.toml") });
  assert.equal(cfg.outPath, path.join(dir, "data", "stats.json"));
  const quiet = () => {};
  const stats = await aggregate(cfg, { live: false, log: quiet, warn: quiet });
  assert.deepEqual(
    stats.components.map((c) => c.id),
    ["widget"],
  );
  const [w] = stats.components;
  assert.equal(w.description, "A widget");
  assert.deepEqual(w.downloads.hacs, { "2026-01-02": 2, "2026-01-03": 2 });
  assert.deepEqual(w.downloads.ghcr, { "2026-01-02": 3, "2026-01-03": 3 });
  assert.equal(w.kpis.downloads7, 10);
  assert.deepEqual(w.kpis.totals, { hacs: 14, ghcr: 106 });
  assert.deepEqual(
    stats.websites.map((s) => [s.id, s.product]),
    [
      ["widget", true],
      ["www", false],
    ],
  );
  // Days before any site counted a view are dropped.
  assert.deepEqual(w.pageViews, { "2026-01-01": 2, "2026-01-02": 3 });
  assert.equal(stats.org.name, "Example");
  assert.deepEqual(JSON.parse(await readFile(cfg.outPath, "utf8")).components[0].id, "widget");

  assert.deepEqual(families(cfg.registry), { families: [["tool", "Tools"]], metaLabel: "Us" });
  const sidebar = usageSidebar({ config: path.join(dir, "repos.toml") });
  assert.deepEqual(sidebar, [
    { label: "Downloads", link: "/usage/" },
    { label: "Page views", link: "/usage/page-views/" },
    { label: "Tools", collapsed: true, items: [{ label: "widget", link: "/usage/widget/" }] },
    { label: "Community", link: "/usage/community/" },
  ]);
});

test("build: community projects kept apart from the org's components and totals", async () => {
  const dir = await fixture();
  const cfg = loadConfig({ config: path.join(dir, "repos.toml") });
  const quiet = () => {};
  const stats = await aggregate(cfg, { live: false, log: quiet, warn: quiet });
  assert.deepEqual(
    stats.community.map((p) => [p.id, p.name, p.author, p.extends]),
    [["widget-card", "widget-card", "someone", "widget"]],
  );
  const [card] = stats.community;
  assert.deepEqual(card.downloads.hacs, { "2026-01-02": 20, "2026-01-03": 20 });
  assert.deepEqual(card.kpis.totals, { hacs: 140 });
  assert.equal(card.kpis.stars, 14);
  assert.equal(card.license, "MIT");
  assert.equal(card.latestRelease.tag, "v2");
  // Nothing of the community project reaches the org's own figures.
  assert.ok(!stats.components.some((c) => c.id === "widget-card"));
  assert.equal(stats.components[0].kpis.downloads7, 10);
});
