// A repos.toml and two days of snapshots, shared by the tests.
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "hq-stats-"));
  await writeFile(
    path.join(dir, "repos.toml"),
    `[org]
name = "Example"
github = "example"

[stats]
data_dir = "data/stats"

[families]
tool = { label = "Tools" }
meta = { label = "Us" }

[repos.widget]
family = "tool"
hacs_zip = "widget.zip"
ghcr = "widget"
goatcounter = "widget"

[repos.www]
family = "meta"
goatcounter = "www"

[repos.gone]
family = "tool"
archived = true

[repos.secret]
family = "tool"

[community.widget-card]
repo = "someone/widget-card"
author = "someone"
extends = "widget"
hacs_zip = "card.js"

[community.blog]
kind = "blog"
url = "https://blog.example.org"
`,
  );
  const snap = (date, zip, pulls, views) => ({
    collected_at: `${date}T05:00:00+00:00`,
    repos: {
      widget: {
        github: {
          description: "A widget",
          archived: false,
          stars: 3,
          views: [{ timestamp: `${date}T00:00:00Z`, count: 1, uniques: 1 }],
          clones: [],
          release_assets: { "v1.0.0": { "widget.zip": zip } },
        },
        ghcr: { total: pulls },
        goatcounter: { site: "widget", daily: views, top_pages_30d: [{ path: "/", title: "Home", count: 9 }] },
      },
      www: { github: { stars: 0, views: [], clones: [], release_assets: {} }, goatcounter: { site: "www", daily: {}, top_pages_30d: [] } },
      gone: { github: { stars: 0, views: [], clones: [], release_assets: {} } },
    },
    community: {
      "widget-card": {
        github: {
          description: "A card",
          archived: false,
          license: "MIT",
          stars: zip,
          forks: 0,
          latest_release: { tag: "v2", date: `${date}T00:00:00Z`, url: "https://github.com/someone/widget-card/releases/v2" },
          release_assets: { v2: { "card.js": zip * 10 } },
        },
      },
    },
  });
  await mkdir(path.join(dir, "data", "stats"), { recursive: true });
  await writeFile(path.join(dir, "data", "stats", "2026-01-01.json"), JSON.stringify(snap("2026-01-01", 10, 100, { "2025-12-31": 0 })));
  await writeFile(
    path.join(dir, "data", "stats", "2026-01-03.json"),
    JSON.stringify(snap("2026-01-03", 14, 106, { "2026-01-01": 2, "2026-01-02": 3 })),
  );
  return dir;
}
