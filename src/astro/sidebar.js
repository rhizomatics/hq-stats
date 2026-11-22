// Starlight sidebar entries for the Usage pages: Downloads, Page views, each component under its family, then
// Community when there are community projects.
// Synchronous, for astro.config.mjs. Takes the same options as the integration; paths relative to the working
// directory (where Astro runs).
import { families } from "../config.js";
import { readStats, resolveOptions } from "./index.js";

export function usageSidebar(options = {}) {
  const { cfg, base, statsPath } = resolveOptions(options);
  const { components, community = [] } = readStats(statsPath, cfg.org);
  const { families: fams } = families(cfg.registry);
  const listed = new Set(fams.map(([f]) => f));
  const link = (p = "") => `${base}/${p}`;
  const groups = [...fams, [null, "Other"]]
    .map(([family, label]) => ({
      label,
      collapsed: true,
      items: components
        .filter((c) => (family === null ? !listed.has(c.family) : c.family === family))
        .map((c) => ({ label: c.id, link: link(`${c.id}/`) })),
    }))
    .filter((g) => g.items.length);
  const others = community.length ? [{ label: "Community", link: link("community/") }] : [];
  return [{ label: "Downloads", link: link() }, { label: "Page views", link: link("page-views/") }, ...groups, ...others];
}
