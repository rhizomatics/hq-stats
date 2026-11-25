// Configuration: one internal model of the org's product lines, products and their artefacts, read from either
// layout:
//
//   hq.toml + products.toml (+ community.toml)   from 0.3.0
//     hq.toml        [org] github, name; [stats]; [lines.<id>] in display order; [platforms.<id>]; anything else
//                    is the host's own (HQ keeps labels and capabilities there) and ignored here
//     products.toml  one table per product, keyed by its slug:
//                      line, repos (default: [slug]), description, platform, significance ("major"),
//                      lifecycle ("active" | "experimental" | "archived"), public (default true),
//                      formerly = { name } (repo names before a rename),
//                      artefacts.<name> = "<package>" | { distribution (default: <name>), package, asset, domain,
//                                                         goatcounter, platform, formerly = { ... } }
//     community.toml one table per community entry: kind ("project" | "blog"), repo, author, extends (a product
//                    slug), line, artefacts as on a product; blogs: title, url, author, note
//
//   repos.toml (deprecated, read until at least 1.0)
//     [org], [stats], [families.<id>] label, [repos.<name>] family, upstream, category, archived, pypi, npm, ghcr,
//     hacs_zip, ha_domain, goatcounter, formerly, [community.<id>]: mapped by `reposTomlToLayout`, which is also
//     what `hq-stats migrate` writes.
//
// [stats] (all optional; paths relative to the config's directory):
//   data_dir     where daily snapshots go             default "data/stats"
//   legacy_hacs  history from the retired hacs-downloads site, if any
//   out          the public aggregate `build` writes  default "<data_dir>/../stats.json"
//
// Snapshots stay keyed by repo; a product is a grouping of its repos at build time.

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";

export const LAYOUT = { hq: "hq.toml", products: "products.toml", community: "community.toml" };
const LEGACY = "repos.toml";
const SLUG = /^[a-z0-9_-]+$/;
const LIFECYCLES = ["active", "experimental", "archived"];

// The distributions hq-stats can count. Other distributions are fine in the config and ignored here.
export const COUNTED = {
  npm: "npm downloads",
  pypi: "PyPI downloads",
  ghcr: "GitHub Container Registry pulls",
  homeassistant_marketplace_integration: "HACS downloads of the release asset, Home Assistant analytics installs",
  homeassistant_marketplace_frontend: "HACS downloads of the release asset",
  website: "GoatCounter page views",
};

export const isTable = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
const asList = (v) => (v == null ? [] : [v].flat());
const unique = (list) => [...new Set(list)];

// Where the config is: a directory with hq.toml (preferred) or repos.toml, or one of those files.
export function findConfig(explicit) {
  const tried = [];
  const inDir = (dir) => {
    if (existsSync(path.join(dir, LAYOUT.hq))) return { layout: "hq", dir };
    if (existsSync(path.join(dir, LEGACY))) return { layout: "repos", dir, file: path.join(dir, LEGACY) };
    return null;
  };
  const at = (p) => {
    const abs = path.resolve(p);
    tried.push(abs);
    if (!existsSync(abs)) return null;
    if (statSync(abs).isDirectory()) return inDir(abs);
    if (Object.values(LAYOUT).includes(path.basename(abs))) return { layout: "hq", dir: path.dirname(abs) };
    return { layout: "repos", dir: path.dirname(abs), file: abs };
  };
  const candidates = explicit ? [explicit] : [process.env.HQ_CONFIG, process.env.REPOS_TOML, ".", ".."].filter(Boolean);
  for (const c of candidates) {
    const found = at(c);
    if (found) return found;
  }
  throw new Error(`no ${LAYOUT.hq} or ${LEGACY} found (tried ${tried.join(", ")}); pass --config`);
}

// Kept for 0.2 callers: the config file found.
export const findRegistry = (explicit) => {
  const found = findConfig(explicit);
  return found.file ?? path.join(found.dir, LAYOUT.hq);
};

const readToml = (file) => parseToml(readFileSync(file, "utf8"));

// The three files' contents, whichever layout is on disk.
export function readLayout(found) {
  if (found.layout === "repos") return { layout: reposTomlToLayout(readToml(found.file)), files: [found.file] };
  const files = [];
  const read = (name, required) => {
    const file = path.join(found.dir, LAYOUT[name]);
    if (!existsSync(file)) {
      if (required) throw new Error(`${file} not found`);
      return {};
    }
    files.push(file);
    return readToml(file);
  };
  return { layout: { hq: read("hq", true), products: read("products"), community: read("community") }, files };
}

let warned = false;

export function loadConfig({ config, data, legacy, out, warn = console.warn } = {}) {
  const found = findConfig(config);
  const { layout, files } = readLayout(found);
  if (found.layout === "repos" && !warned) {
    warned = true;
    warn(
      `hq-stats: ${path.basename(found.file)} is deprecated (read until at least 1.0); \`hq-stats migrate\` writes hq.toml, products.toml and community.toml from it`,
    );
  }
  const model = fromLayout(layout, files[0]);
  const stats = model.settings.stats ?? {};
  const dir = found.dir;
  const dataDir = path.resolve(data ?? path.resolve(dir, stats.data_dir ?? "data/stats"));
  return {
    layout: found.layout,
    dir,
    files,
    registryPath: files[0],
    ...model,
    dataDir,
    legacyPath: legacy ?? (stats.legacy_hacs ? path.resolve(dir, stats.legacy_hacs) : null),
    outPath: path.resolve(out ?? (stats.out ? path.resolve(dir, stats.out) : path.join(dataDir, "..", "stats.json"))),
  };
}

function artefact(name, value, inherited, where) {
  if (typeof value !== "string" && !isTable(value)) throw new Error(`${where}: artefacts.${name} should be a package name or a table`);
  const a = typeof value === "string" ? { package: value } : { ...value };
  return {
    ...a,
    name,
    distribution: a.distribution ?? name,
    platforms: a.platform !== undefined ? asList(a.platform) : inherited,
    formerly: isTable(a.formerly) ? a.formerly : {},
  };
}

// The normalised model from the three files' contents. Platform cascades line -> product -> artefact; a product's
// platforms are its own plus its artefacts'.
export function fromLayout({ hq = {}, products = {}, community = {} }, source = LAYOUT.hq) {
  if (!hq.org?.github) throw new Error(`${source}: [org] github is required`);
  const lines = Object.entries(hq.lines ?? {}).map(([id, l]) => ({
    ...l,
    id,
    name: l.name ?? id,
    kind: l.kind ?? "product",
    platforms: asList(l.platform),
  }));
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const owner = new Map();
  const prods = Object.entries(products).map(([id, p]) => {
    const where = `${LAYOUT.products} [${id}]`;
    if (!isTable(p)) throw new Error(`${where} isn't a table`);
    if (!SLUG.test(id)) throw new Error(`${where}: a product slug is lower case letters, digits, - and _`);
    if (p.line && !lineById.has(p.line)) throw new Error(`${where}: line "${p.line}" isn't in ${LAYOUT.hq} [lines]`);
    const lifecycle = p.lifecycle ?? "active";
    if (!LIFECYCLES.includes(lifecycle)) throw new Error(`${where}: lifecycle "${lifecycle}" isn't one of ${LIFECYCLES.join(", ")}`);
    const repos = asList(p.repos ?? id);
    for (const r of repos) {
      if (owner.has(r)) throw new Error(`${where}: repo "${r}" is already in product ${owner.get(r)} (a repo belongs to one product)`);
      owner.set(r, id);
    }
    const own = p.platform !== undefined ? asList(p.platform) : (lineById.get(p.line)?.platforms ?? []);
    const artefacts = Object.entries(p.artefacts ?? {}).map(([n, v]) => artefact(n, v, own, where));
    return {
      ...p,
      id,
      line: p.line ?? null,
      repos,
      description: p.description ?? "",
      significance: p.significance ?? null,
      lifecycle,
      public: p.public !== false,
      platforms: unique([...own, ...artefacts.flatMap((a) => a.platforms)]),
      artefacts,
      formerly: { ...p.formerly, name: asList(p.formerly?.name) },
    };
  });
  const prodById = new Map(prods.map((p) => [p.id, p]));
  const comm = Object.entries(community).map(([id, e]) => {
    const where = `${LAYOUT.community} [${id}]`;
    if (!isTable(e)) throw new Error(`${where} isn't a table`);
    return {
      ...e,
      id,
      kind: e.kind ?? "project",
      extends: e.extends ?? null,
      line: e.line ?? prodById.get(e.extends)?.line ?? null,
      artefacts: Object.entries(e.artefacts ?? {}).map(([n, v]) => artefact(n, v, [], where)),
      formerly: { ...e.formerly, name: asList(e.formerly?.name) },
    };
  });
  return {
    settings: hq,
    org: { github: hq.org.github, name: hq.org.name ?? hq.org.github },
    lines,
    platforms: hq.platforms ?? {},
    products: prods,
    community: comm,
  };
}

// What hq-stats counts for a product or community entry, from its artefacts: each channel's current names first,
// then former ones (a renamed package's downloads are summed with the new one's).
export function channels(entry) {
  const c = { npm: [], pypi: [], ghcr: [], hacs: [], haDomains: [], goatcounter: null };
  for (const a of entry.artefacts ?? []) {
    const was = (field) => asList(a.formerly?.[field]);
    switch (a.distribution) {
      case "npm":
      case "pypi":
      case "ghcr":
        if (a.package) c[a.distribution].push(a.package, ...was("package"));
        break;
      case "homeassistant_marketplace_integration":
      case "homeassistant_marketplace_frontend":
        if (a.asset) c.hacs.push(a.asset, ...was("asset"));
        if (a.domain) c.haDomains.push(a.domain, ...was("domain"));
        break;
      case "website":
        c.goatcounter ??= a.goatcounter ?? null;
        break;
      default:
    }
  }
  return c;
}

const lineOf = (cfg, id) => cfg.lines.find((l) => l.id === id);

// An org line holds the org's own things (its sites, HQ itself): page views only, never a product.
export const isOrgLine = (cfg, id) => lineOf(cfg, id)?.kind === "org";

// A product for the catalogue, totals and per-product processes: public, active, not on an org line.
export const isProduct = (cfg, p) => p.public && p.lifecycle === "active" && !isOrgLine(cfg, p.line);

// Lines for headings, in display order, as [id, name]: product lines, then the org's own.
export function lines(cfg) {
  const pair = (l) => [l.id, l.name];
  return { lines: cfg.lines.filter((l) => l.kind !== "org").map(pair), orgLines: cfg.lines.filter((l) => l.kind === "org").map(pair) };
}

// 0.2's helper, for callers still on it: takes a loaded config or a parsed repos.toml.
export function families(cfgOrRegistry) {
  const cfg = Array.isArray(cfgOrRegistry.lines) ? cfgOrRegistry : fromLayout(reposTomlToLayout(cfgOrRegistry));
  const { lines: product, orgLines } = lines(cfg);
  return { families: product, metaLabel: orgLines[0]?.[1] ?? "Organisation" };
}

// ---- repos.toml -> the three files ----

const CHANNEL_FIELDS = ["pypi", "npm", "ghcr", "hacs_zip", "ha_domain", "goatcounter"];

function channelArtefacts(fields, was = {}) {
  const a = {};
  for (const d of ["pypi", "npm", "ghcr"]) {
    if (!fields[d]) continue;
    a[d] = was[d] ? { package: fields[d], formerly: { package: was[d] } } : fields[d];
  }
  if (fields.hacs_zip || fields.ha_domain) {
    const frontend = fields.hacs_zip?.endsWith(".js") && !fields.ha_domain;
    const t = {};
    if (fields.hacs_zip) t.asset = fields.hacs_zip;
    if (fields.ha_domain) t.domain = fields.ha_domain;
    const f = {};
    if (was.hacs_zip) f.asset = was.hacs_zip;
    if (was.ha_domain) f.domain = was.ha_domain;
    if (Object.keys(f).length) t.formerly = f;
    a[frontend ? "homeassistant_marketplace_frontend" : "homeassistant_marketplace_integration"] = t;
  }
  if (fields.goatcounter) a.website = { goatcounter: fields.goatcounter };
  return a;
}

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
const omit = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));

function slugFor(repo, taken) {
  const base =
    repo
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "") || "repo";
  let slug = base;
  for (let i = 2; taken.has(slug); i += 1) slug = `${base}-${i}`;
  taken.add(slug);
  return slug;
}

// repos.toml's tables as hq.toml, products.toml and community.toml. Families map one to one to lines (`meta`
// becomes a line with kind = "org"); `upstream` becomes `platform`, on the line when all its repos share it;
// `category` becomes `significance`, `lifecycle` and `public`; channel fields become artefacts. Fields hq-stats
// doesn't know are carried over unchanged.
export function reposTomlToLayout(registry) {
  const { repos = {}, families: fams = {}, community = {}, org, stats, ...rest } = registry;
  const lineTables = {};
  for (const [id, f] of Object.entries(fams)) {
    const { label, ...more } = f;
    lineTables[id] = { name: label ?? id, ...(id === "meta" ? { kind: "org" } : {}), ...more };
  }
  for (const r of Object.values(repos)) if (r.family && !lineTables[r.family]) lineTables[r.family] = { name: r.family };
  for (const id of Object.keys(lineTables)) {
    const members = Object.values(repos).filter((r) => r.family === id);
    const ups = unique(members.map((r) => r.upstream ?? null));
    if (members.length && ups.length === 1 && ups[0]) lineTables[id].platform = ups[0];
  }

  const taken = new Set();
  const slugs = {};
  const products = {};
  for (const [repo, r] of Object.entries(repos)) {
    const slug = slugFor(repo, taken);
    slugs[repo] = slug;
    const category = asList(r.category);
    const p = {};
    if (r.family) p.line = r.family;
    if (slug !== repo) p.repos = [repo];
    if (r.description) p.description = r.description;
    if (r.upstream && r.upstream !== lineTables[r.family]?.platform) p.platform = r.upstream;
    if (category.includes("major")) p.significance = "major";
    if (r.archived) p.lifecycle = "archived";
    else if (category.includes("experimental")) p.lifecycle = "experimental";
    if (category.includes("internal")) p.public = false;
    const otherCategories = category.filter((c) => !["major", "experimental", "internal"].includes(c));
    if (otherCategories.length) p.category = otherCategories;
    Object.assign(p, omit(r, ["family", "upstream", "category", "archived", "description", "formerly", ...CHANNEL_FIELDS]));
    if (r.formerly?.name) p.formerly = { name: r.formerly.name };
    const artefacts = channelArtefacts(pick(r, CHANNEL_FIELDS), r.formerly);
    if (Object.keys(artefacts).length) p.artefacts = artefacts;
    products[slug] = p;
  }

  const comm = {};
  for (const [id, e] of Object.entries(community)) {
    const c = omit(e, ["formerly", "extends", ...CHANNEL_FIELDS]);
    if (e.extends) c.extends = slugs[e.extends] ?? e.extends;
    if (e.formerly?.name) c.formerly = { name: e.formerly.name };
    const artefacts = channelArtefacts(pick(e, CHANNEL_FIELDS), e.formerly);
    if (Object.keys(artefacts).length) c.artefacts = artefacts;
    comm[id] = c;
  }

  const platforms = unique(
    Object.values(repos)
      .map((r) => r.upstream)
      .filter(Boolean),
  );
  const hq = { org, ...(stats ? { stats } : {}), lines: lineTables };
  if (platforms.length) hq.platforms = Object.fromEntries(platforms.map((p) => [p, {}]));
  return { hq: { ...hq, ...rest }, products, community: comm };
}
