// Astro integration: mounts the Usage pages (Downloads, Page views, one page per component) in a Starlight site.
//
//   import starlight from '@astrojs/starlight';
//   import hqStats from '@rhizomatics/hq-stats/astro';
//   import { usageSidebar } from '@rhizomatics/hq-stats/sidebar';
//   integrations: [starlight({ sidebar: [{ label: 'Usage', items: usageSidebar() }] }), hqStats()]
//
// Options (paths relative to the site's root):
//   config  repos.toml                 default: $REPOS_TOML, ./repos.toml, ../repos.toml
//   stats   the aggregate from `build`  default: [stats] out in repos.toml
//   base    where the pages are mounted default: 'usage'
//
// Pages: <base>/ (Downloads), <base>/page-views/, <base>/<repo>/, and <base>/community/ when repos.toml lists
// community projects.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { families, loadConfig } from "../config.js";
import { communityProjects } from "../collect.js";

const VIRTUAL = "virtual:hq-stats";
const RESOLVED = `\0${VIRTUAL}`;
const page = (name) => `@rhizomatics/hq-stats/pages/${name}.astro`;

export function resolveOptions(options = {}, root = process.cwd()) {
  const at = (p) => (p ? path.resolve(root, p) : undefined);
  const cfg = loadConfig({ config: at(options.config), out: at(options.stats) });
  const base = `/${(options.base ?? "usage").replace(/^\/+|\/+$/g, "")}`;
  return { cfg, base, statsPath: cfg.outPath };
}

// Before the first `hq-stats build` the pages still render, saying there's nothing yet.
export function readStats(statsPath, org) {
  if (!existsSync(statsPath)) {
    return {
      format: 1,
      generatedAt: null,
      org,
      snapshotDate: null,
      firstSnapshot: null,
      pageViewsSince: null,
      notes: [`No stats yet: run \`hq-stats build\` (looked for ${statsPath}).`],
      components: [],
      websites: [],
      community: [],
    };
  }
  return JSON.parse(readFileSync(statsPath, "utf8"));
}

export default function hqStats(options = {}) {
  return {
    name: "@rhizomatics/hq-stats",
    hooks: {
      "astro:config:setup": ({ config, injectRoute, updateConfig }) => {
        const { cfg, base, statsPath } = resolveOptions(options, fileURLToPath(config.root));
        const { families: fams, metaLabel } = families(cfg.registry);
        updateConfig({
          vite: {
            plugins: [
              {
                name: "hq-stats",
                resolveId: (id) => (id === VIRTUAL ? RESOLVED : undefined),
                load(id) {
                  if (id !== RESOLVED) return undefined;
                  if (existsSync(statsPath)) this.addWatchFile(statsPath);
                  const stats = readStats(statsPath, cfg.org);
                  return `export const stats = ${JSON.stringify(stats)};\nexport const config = ${JSON.stringify({ base, org: cfg.org, families: fams, metaLabel })};\n`;
                },
              },
            ],
          },
        });
        injectRoute({ pattern: `${base}`, entrypoint: page("downloads") });
        injectRoute({ pattern: `${base}/page-views`, entrypoint: page("page-views") });
        if (communityProjects(cfg.registry).length) injectRoute({ pattern: `${base}/community`, entrypoint: page("community") });
        injectRoute({ pattern: `${base}/[id]`, entrypoint: page("component") });
      },
    },
  };
}
