#!/usr/bin/env node
// hq-stats: collect daily usage snapshots and build the public aggregate behind the Usage pages.
import { parseArgs } from "node:util";
import { aggregate, collect, loadConfig } from "../src/index.js";

const HELP = `Usage: hq-stats <command> [options]

Commands:
  collect   snapshot every public repo in repos.toml to <data_dir>/YYYY-MM-DD.json (run daily)
  build     write the public aggregate (stats.json) from the snapshots, for the pages or your own use

Options:
  --config <path>   repos.toml (default: $REPOS_TOML, ./repos.toml, ../repos.toml)
  --data <dir>      snapshot directory (default: [stats] data_dir, or data/stats next to repos.toml)
  --legacy <file>   history from the retired hacs-downloads site (default: [stats] legacy_hacs)
  --out <file>      where build writes stats.json (default: [stats] out, or stats.json beside the data dir)
  --offline         build without live npm, PyPI and Home Assistant calls (snapshot figures only)
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
    help: { type: "boolean", short: "h", default: false },
  },
});

const [command] = positionals;
if (values.help || !command) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}

try {
  const cfg = loadConfig(values);
  if (command === "collect") await collect(cfg);
  else if (command === "build") await aggregate(cfg, { live: !values.offline });
  else {
    console.error(`unknown command: ${command}\n\n${HELP}`);
    process.exit(1);
  }
} catch (e) {
  console.error(`hq-stats ${command}: ${e.message}`);
  process.exit(1);
}
