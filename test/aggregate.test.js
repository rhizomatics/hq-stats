import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { aggregate, cumulativeToDaily, fromBaseline, sumRecent, traffic } from "../src/aggregate.js";
import { sortKeys } from "../src/collect.js";
import { channels, families, loadConfig } from "../src/config.js";
import { usageSidebar } from "../src/astro/sidebar.js";
import { fixture } from "./fixture.js";

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

test("build: public, unarchived repos only; downloads, page views and totals from snapshots", async () => {
  const dir = await fixture();
  const cfg = loadConfig({ config: path.join(dir, "repos.toml"), warn: () => {} });
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

  assert.deepEqual(families(cfg), { families: [["tool", "Tools"]], metaLabel: "Us" });
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
  const cfg = loadConfig({ config: path.join(dir, "repos.toml"), warn: () => {} });
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
  assert.equal(card.relation, "extends"); // the default; "recommended" passes through
  // Nothing of the community project reaches the org's own figures.
  assert.ok(!stats.components.some((c) => c.id === "widget-card"));
  assert.equal(stats.components[0].kpis.downloads7, 10);
});

test("channels: current names first, then former ones (string or list)", () => {
  const c = channels({
    artefacts: [
      { distribution: "npm", package: "b", formerly: { package: "a" } },
      { distribution: "homeassistant_marketplace_integration", asset: "c.zip", domain: "c", formerly: { asset: ["b.zip", "a.zip"] } },
      { distribution: "pypi", package: "x", formerly: {} },
      { distribution: "website", goatcounter: "site", formerly: {} },
      { distribution: "github_release", asset: "fw.uf2", formerly: {} },
    ],
  });
  assert.deepEqual(c, { npm: ["b", "a"], pypi: ["x"], ghcr: [], hacs: ["c.zip", "b.zip", "a.zip"], haDomains: ["c"], goatcounter: "site" });
  assert.deepEqual(channels({ artefacts: [] }).pypi, []);
});

test("build: formerly counts a renamed repo's old snapshots and its old release asset name", async () => {
  const dir = await fixture();
  const toml = path.join(dir, "repos.toml");
  await writeFile(
    toml,
    (await readFile(toml, "utf8")).replace(
      'hacs_zip = "widget.zip"',
      'hacs_zip = "widget.zip"\nformerly = { name = "old-widget", hacs_zip = "old_widget.zip" }',
    ),
  );
  for (const f of ["2026-01-01.json", "2026-01-03.json"]) {
    const p = path.join(dir, "data", "stats", f);
    const s = JSON.parse(await readFile(p, "utf8"));
    s.repos.widget.github.release_assets["v0.9.0"] = { "old_widget.zip": 5 };
    // The first snapshot was taken before the repo was renamed.
    if (f === "2026-01-01.json") {
      s.repos["old-widget"] = s.repos.widget;
      delete s.repos.widget;
    }
    await writeFile(p, JSON.stringify(s));
  }
  const quiet = () => {};
  const stats = await aggregate(loadConfig({ config: toml }), { live: false, log: quiet, warn: quiet });
  const [w] = stats.components;
  assert.equal(w.id, "widget");
  assert.equal(w.kpis.totals.hacs, 19);
  assert.deepEqual(w.downloads.hacs, { "2026-01-02": 2, "2026-01-03": 2 });
  assert.deepEqual(
    w.hacsVersions.map((v) => [v.version, v.downloads]),
    [
      ["v1.0.0", 14],
      ["v0.9.0", 5],
    ],
  );
});
