// A site with nothing but the Usage pages. Put this folder next to your repos.toml (e.g. as site/).
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import hqStats from "@rhizomatics/hq-stats/astro";
import { usageSidebar } from "@rhizomatics/hq-stats/sidebar";

const options = { config: "../repos.toml" };

export default defineConfig({
  site: "https://stats.example.org",
  trailingSlash: "always",
  integrations: [
    starlight({
      title: "Usage",
      sidebar: [{ label: "Usage", items: usageSidebar(options) }],
    }),
    hqStats(options),
  ],
});
