// Starlight sidebar entries for the Usage pages: Downloads, Page views, each component under its product line, then
// Community when there are community projects.
// Synchronous, for astro.config.mjs. Takes the same options as the integration; paths relative to the working
// directory (where Astro runs).
import { lines } from "../config.js";
import { readStats, resolveOptions } from "./index.js";

export function usageSidebar(options = {}) {
  const { cfg, base, statsPath } = resolveOptions(options);
  const { components, community = [] } = readStats(statsPath, cfg.org);
  const { lines: productLines } = lines(cfg);
  const listed = new Set(productLines.map(([l]) => l));
  const lineOf = (c) => c.line ?? c.family ?? null;
  const link = (p = "") => `${base}/${p}`;
  const groups = [...productLines, [null, "Other"]]
    .map(([line, label]) => ({
      label,
      collapsed: true,
      items: components
        .filter((c) => (line === null ? !listed.has(lineOf(c)) : lineOf(c) === line))
        .map((c) => ({ label: c.id, link: link(`${c.id}/`) })),
    }))
    .filter((g) => g.items.length);
  const others = community.length ? [{ label: "Community", link: link("community/") }] : [];
  return [{ label: "Downloads", link: link() }, { label: "Page views", link: link("page-views/") }, ...groups, ...others];
}
