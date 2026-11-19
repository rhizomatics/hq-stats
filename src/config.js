// Configuration: the org's repo registry (`repos.toml`) and its optional `[stats]` section.
//
// repos.toml needs only:
//   [org]    github = "<org or user>", name = "<display name>"
//   [repos.<name>]  one table per repo, with the channel fields it publishes to:
//            pypi, npm, ghcr, hacs_zip, ha_domain, goatcounter (see README), plus optional
//            family (a key of [families]), category (["experimental", "internal", ...]) and archived.
//   [families.<id>]  optional: label = "<heading>", in display order
//
// [stats] (all optional; paths relative to repos.toml):
//   data_dir     where daily snapshots go             default "data/stats"
//   legacy_hacs  history from the retired hacs-downloads site, if any
//   out          the public aggregate `build` writes  default "<data_dir>/../stats.json"

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";

export function findRegistry(explicit) {
  const candidates = [explicit, process.env.REPOS_TOML, "repos.toml", "../repos.toml"].filter(Boolean).map((p) => path.resolve(p));
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`repos.toml not found (tried ${candidates.join(", ")}); pass --config`);
  return found;
}

export function loadConfig({ config, data, legacy, out } = {}) {
  const registryPath = findRegistry(config);
  const registry = parseToml(readFileSync(registryPath, "utf8"));
  if (!registry.org?.github) throw new Error(`${registryPath}: [org] github is required`);
  const dir = path.dirname(registryPath);
  const stats = registry.stats ?? {};
  const dataDir = path.resolve(data ?? path.resolve(dir, stats.data_dir ?? "data/stats"));
  return {
    registryPath,
    registry,
    org: { github: registry.org.github, name: registry.org.name ?? registry.org.github },
    dataDir,
    legacyPath: legacy ?? (stats.legacy_hacs ? path.resolve(dir, stats.legacy_hacs) : null),
    outPath: path.resolve(out ?? (stats.out ? path.resolve(dir, stats.out) : path.join(dataDir, "..", "stats.json"))),
  };
}

// [family, heading] in display order, `meta` (the org's own repos) last under its own label.
export function families(registry) {
  const all = Object.entries(registry.families ?? {}).map(([id, f]) => [id, f.label ?? id]);
  return {
    families: all.filter(([id]) => id !== "meta"),
    metaLabel: registry.families?.meta?.label ?? "Organisation",
  };
}
