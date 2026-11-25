#!/usr/bin/env node
// hq-stats: collect daily usage snapshots and build the public aggregate behind the Usage pages.
import { parseArgs } from "node:util";
import { aggregate, collect, loadConfig, migrate } from "../src/index.js";

const HELP = `Usage: hq-stats <command> [options]

Commands:
  collect   snapshot every public repo of every product to <data_dir>/YYYY-MM-DD.json (run daily)
  build     write the public aggregate (stats.json) from the snapshots, for the pages or your own use
  migrate   write hq.toml, products.toml and community.toml from a repos.toml (into its directory, or --out)

Options:
  --config <path>   the directory with hq.toml + products.toml, or a repos.toml
                    (default: $HQ_CONFIG, $REPOS_TOML, then . and .., hq.toml before repos.toml)
  --data <dir>      snapshot directory (default: [stats] data_dir, or data/stats next to repos.toml)
  --legacy <file>   history from the retired hacs-downloads site (default: [stats] legacy_hacs)
  --out <path>      build: where stats.json goes (default: [stats] out, or stats.json beside the data dir);
                    migrate: the directory for the new files (default: repos.toml's)
  --offline         build without live npm, PyPI and Home Assistant calls (snapshot figures only)
  --force           migrate: overwrite existing files
  -h, --help        this help

Tokens: GITHUB_TOKEN (or GH_TOKEN, or a logged-in gh CLI); GOATCOUNTER_TOKEN for page views.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: "string" },
    data: { type: "string" },
    legacy: { type: "string" },
    out: { type: "string" },
    offline: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

const [command] = positionals;
if (values.help || !command) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}

try {
  if (command === "migrate") await migrate({ config: values.config, out: values.out, force: values.force });
  else if (command === "collect") await collect(loadConfig(values));
  else if (command === "build") await aggregate(loadConfig(values), { live: !values.offline });
  else {
    console.error(`unknown command: ${command}\n\n${HELP}`);
    process.exit(1);
  }
} catch (e) {
  console.error(`hq-stats ${command}: ${e.message}`);
  process.exit(1);
}
