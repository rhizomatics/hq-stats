import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parse as parseToml } from "smol-toml";
import { aggregate } from "../src/aggregate.js";
import { findConfig, fromLayout, isProduct, lines, loadConfig, reposTomlToLayout } from "../src/config.js";
import { migrate, migrateText } from "../src/migrate.js";
import { fixture } from "./fixture.js";

const quiet = () => {};
const plain = (x) => JSON.parse(JSON.stringify(x));

const REPOS = `
[org]
github = "example"

[families]
ha = { label = "Home Assistant", area = "homeassistant" }
tools = { label = "Tools" }
meta = { label = "Us" }

[labels]
sources = ["support"]

[[security_watch]]
ecosystem = "pip"
package = "homeassistant"

[repos.integ]
family = "ha"
upstream = "homeassistant"
hacs_zip = "integ.zip"
ha_domain = "integ"
goatcounter = "integ"
category = ["major"]
formerly = { name = "old-integ", hacs_zip = "old_integ.zip", ha_domain = "old_integ" }

[repos.card]
family = "ha"
upstream = "homeassistant"
hacs_zip = "card.js"
npm = "@example/card"
formerly = { npm = "card" }

[repos.cli]
family = "tools"
pypi = "example-cli"
ghcr = "example-cli"
category = ["experimental"]

[repos.".github"]
family = "meta"
goatcounter = "example"

[repos.secret]
family = "meta"
category = ["internal"]

[repos.old]
family = "tools"
archived = true

[community.addon]
repo = "someone/addon"
extends = "integ"
hacs_zip = "addon.js"

[community.blog]
kind = "blog"
url = "https://blog.example.org"
`;

test("repos.toml maps to lines, products, artefacts and community", () => {
  const { hq, products, community } = plain(reposTomlToLayout(parseToml(REPOS)));
  assert.deepEqual(hq.lines, {
    ha: { name: "Home Assistant", area: "homeassistant", platform: "homeassistant" },
    tools: { name: "Tools" },
    meta: { name: "Us", kind: "org" },
  });
  assert.deepEqual(hq.platforms, { homeassistant: {} });
  assert.deepEqual(hq.labels, { sources: ["support"] });
  assert.equal(hq.security_watch.length, 1);
  assert.deepEqual(products.integ, {
    line: "ha",
    significance: "major",
    formerly: { name: "old-integ" },
    artefacts: {
      homeassistant_marketplace_integration: {
        asset: "integ.zip",
        domain: "integ",
        formerly: { asset: "old_integ.zip", domain: "old_integ" },
      },
      website: { goatcounter: "integ" },
    },
  });
  assert.deepEqual(products.card.artefacts, {
    npm: { package: "@example/card", formerly: { package: "card" } },
    homeassistant_marketplace_frontend: { asset: "card.js" },
  });
  assert.deepEqual(products.cli, { line: "tools", lifecycle: "experimental", artefacts: { pypi: "example-cli", ghcr: "example-cli" } });
  assert.deepEqual(products.github, { line: "meta", repos: [".github"], artefacts: { website: { goatcounter: "example" } } });
  assert.deepEqual(products.secret, { line: "meta", public: false });
  assert.deepEqual(products.old, { line: "tools", lifecycle: "archived" });
  assert.deepEqual(community.addon, {
    repo: "someone/addon",
    extends: "integ",
    artefacts: { homeassistant_marketplace_frontend: { asset: "addon.js" } },
  });
  assert.deepEqual(community.blog, { kind: "blog", url: "https://blog.example.org" });
});

test("migrate writes files that load to the same model as the repos.toml", () => {
  const layout = reposTomlToLayout(parseToml(REPOS));
  const text = migrateText(parseToml(REPOS));
  assert.deepEqual(Object.keys(text), ["hq.toml", "products.toml", "community.toml"]);
  const reread = {
    hq: parseToml(text["hq.toml"]),
    products: parseToml(text["products.toml"]),
    community: parseToml(text["community.toml"]),
  };
  // Long artefacts are written as their own tables after the short ones; their order carries no meaning.
  const sorted = (m) => {
    const x = plain(m);
    for (const e of [...x.products, ...x.community]) e.artefacts.sort((a, b) => a.name.localeCompare(b.name));
    return x;
  };
  assert.deepEqual(sorted(fromLayout(reread)), sorted(fromLayout(layout)));
  assert.match(text["products.toml"], /^\[integ\]\nline = "ha"/m);
  assert.match(text["products.toml"], /^artefacts\.website = \{ goatcounter = "integ" \}$/m);
  assert.match(text["hq.toml"], /^\[\[security_watch\]\]$/m);
});

test("platform cascades line -> product -> artefact; a product's platforms include its artefacts'", () => {
  const model = fromLayout({
    hq: { org: { github: "x" }, lines: { ha: { platform: "homeassistant" }, pico: {}, org: { kind: "org" } } },
    products: {
      a: { line: "ha" },
      b: { line: "ha", platform: "linux" },
      c: {
        line: "pico",
        artefacts: {
          firmware: { distribution: "github_release", asset: "fw.uf2", platform: "esp32" },
          daemon: { distribution: "github_release", platform: "linux" },
        },
      },
      site: { line: "org", repos: [".github"] },
      hq: { line: "org", repos: ["hq", "hq-private"] },
    },
  });
  const p = Object.fromEntries(model.products.map((x) => [x.id, x]));
  assert.deepEqual(p.a.platforms, ["homeassistant"]);
  assert.deepEqual(p.b.platforms, ["linux"]);
  assert.deepEqual(p.c.platforms, ["esp32", "linux"]);
  assert.deepEqual(
    p.c.artefacts.map((a) => [a.name, a.distribution, a.platforms]),
    [
      ["firmware", "github_release", ["esp32"]],
      ["daemon", "github_release", ["linux"]],
    ],
  );
  assert.deepEqual(p.hq.repos, ["hq", "hq-private"]);
  assert.equal(isProduct(model, p.a), true);
  assert.equal(isProduct(model, p.site), false);
  assert.deepEqual(lines(model), {
    lines: [
      ["ha", "ha"],
      ["pico", "pico"],
    ],
    orgLines: [["org", "org"]],
  });
});

test("the new layout is checked: unknown line, repo in two products, bad slug, bad lifecycle", () => {
  const hq = { org: { github: "x" }, lines: { a: {} } };
  assert.throws(() => fromLayout({ hq, products: { p: { line: "b" } } }), /line "b" isn't in hq.toml/);
  assert.throws(() => fromLayout({ hq, products: { p: {}, q: { repos: ["p"] } } }), /repo "p" is already in product p/);
  assert.throws(() => fromLayout({ hq, products: { "Big.Name": {} } }), /slug/);
  assert.throws(() => fromLayout({ hq, products: { p: { lifecycle: "retired" } } }), /lifecycle "retired"/);
  assert.throws(() => fromLayout({ hq: {}, products: {} }), /\[org\] github is required/);
});

test("hq.toml is found before repos.toml; repos.toml prints a deprecation notice", async () => {
  const dir = await fixture();
  const warnings = [];
  const old = loadConfig({ config: dir, warn: (m) => warnings.push(m) });
  assert.equal(old.layout, "repos");
  await migrate({ config: dir, log: quiet });
  assert.equal(findConfig(dir).layout, "hq");
  const neu = loadConfig({ config: dir, warn: (m) => warnings.push(m) });
  assert.equal(neu.layout, "hq");
  assert.deepEqual(
    neu.files.map((f) => path.basename(f)),
    ["hq.toml", "products.toml", "community.toml"],
  );
  assert.ok(warnings.length <= 1); // once per process at most
  await assert.rejects(migrate({ config: dir, log: quiet }), /already has hq.toml/);
  await assert.rejects(migrate({ config: path.join(dir, "repos.toml"), log: quiet }), /pass --force/);
  await migrate({ config: path.join(dir, "repos.toml"), force: true, log: quiet });
});

test("build gives the same stats.json from repos.toml and from the migrated files", async () => {
  const dir = await fixture();
  const strip = (s) => ({ ...s, generatedAt: null });
  const before = await aggregate(loadConfig({ config: path.join(dir, "repos.toml"), warn: quiet }), {
    live: false,
    log: quiet,
    warn: quiet,
  });
  await migrate({ config: dir, log: quiet });
  await rm(path.join(dir, "repos.toml"));
  const cfg = loadConfig({ config: dir });
  assert.equal(cfg.layout, "hq");
  const after = await aggregate(cfg, { live: false, log: quiet, warn: quiet });
  assert.deepEqual(strip(after), strip(before));
  assert.equal(after.format, 2);
  assert.deepEqual(
    after.components.map((c) => [c.id, c.line, c.family, c.repos]),
    [["widget", "tool", "tool", ["widget"]]],
  );
  assert.deepEqual(
    after.websites.map((w) => [w.id, w.line, w.product]),
    [
      ["widget", "tool", true],
      ["www", "meta", false],
    ],
  );
});

test("build: a product of several repos sums their GitHub figures; its id can differ from its repo", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "hq-stats-"));
  await writeFile(path.join(dir, "hq.toml"), `[org]\ngithub = "example"\n\n[lines.tools]\nname = "Tools"\n\n[lines.org]\nkind = "org"\n`);
  await writeFile(
    path.join(dir, "products.toml"),
    `[suite]\nline = "tools"\nrepos = ["suite-core", "suite-extra"]\nartefacts.pypi = "suite"\n\n[homepage]\nline = "org"\nrepos = [".github"]\nartefacts.website = { goatcounter = "home" }\n`,
  );
  const gh = (stars, views) => ({ stars, views, clones: [], release_assets: { v1: { "a.zip": 1 } } });
  const day = (d, n) => ({ timestamp: `${d}T00:00:00Z`, count: n, uniques: 1 });
  await mkdir(path.join(dir, "data", "stats"), { recursive: true });
  await writeFile(
    path.join(dir, "data", "stats", "2026-01-03.json"),
    JSON.stringify({
      repos: {
        "suite-core": { github: gh(5, [day("2026-01-02", 2)]), pypi: { last_week: 7, last_month: 30 } },
        "suite-extra": { github: gh(2, [day("2026-01-02", 3)]) },
        ".github": { github: gh(0, []), goatcounter: { site: "home", daily: { "2026-01-02": 4 }, top_pages_30d: [] } },
      },
    }),
  );
  const stats = await aggregate(loadConfig({ config: dir }), { live: false, log: quiet, warn: quiet });
  const [suite] = stats.components;
  assert.equal(suite.id, "suite");
  assert.deepEqual(suite.repos, ["suite-core", "suite-extra"]);
  assert.equal(suite.url, "https://github.com/example/suite-core");
  assert.equal(suite.kpis.stars, 7);
  assert.equal(suite.kpis.repoViews14, 5);
  assert.equal(suite.kpis.downloads7, 7);
  assert.deepEqual(
    stats.websites.map((w) => [w.id, w.views7]),
    [["homepage", 4]],
  );
  assert.ok(JSON.parse(await readFile(path.join(dir, "data", "stats.json"), "utf8")).components.length === 1);
});
