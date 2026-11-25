// The public aggregate `hq-stats build` writes (stats.json), format 2. Documented in docs/data-format.md.
// Dates are YYYY-MM-DD (UTC); a Daily maps a date to that day's figure.

export type Daily = Record<string, number>;
export type Traffic = Record<string, { count: number; uniques: number }>;
export type ChannelId = "hacs" | "npm" | "pypi" | "ghcr";

export interface Component {
  id: string; // the product's slug
  line: string | null; // from format 2
  family: string | null; // same as line; dropped at 1.0
  repos: string[]; // from format 2: its public repos
  description: string;
  url: string;
  major: boolean;
  channels: ChannelId[];
  kpis: {
    downloads7: number;
    downloads30: number;
    totals: Partial<Record<ChannelId, number | null>>;
    stars: number | null;
    starsChange7: number | null;
    haInstalls: number | null;
    views7: number | null;
    views30: number | null;
    clones14: number;
    repoViews14: number;
  };
  downloads: Partial<Record<ChannelId, Daily>>;
  pageViews: Daily;
  topPages: { path: string; title: string; count: number }[];
  website: boolean;
  analytics: string | null;
  stars: Daily;
  clones: Traffic;
  repoViews: Traffic;
  haInstalls: Daily;
  haVersions: Record<string, number> | null;
  hacsVersions: { version: string; downloads: number; last7: number | null }[];
}

export interface Website {
  id: string;
  line: string | null; // from format 2
  family: string | null; // same as line; dropped at 1.0
  product: boolean;
  description: string;
  analytics: string;
  daily: Daily;
  views7: number | null;
  views30: number | null;
  topPages: { path: string; title: string; count: number }[];
}

// A project someone else built on one of the org's products, from `[community.<id>]`. Never in the org's totals.
export interface CommunityProject {
  id: string;
  name: string;
  url: string;
  author: string;
  authorUrl: string;
  extends: string | null;
  line: string | null; // from format 2: the line of the product it extends
  description: string;
  license: string | null;
  archived: boolean;
  latestRelease: { tag: string; date: string; url: string } | null;
  channels: ChannelId[];
  kpis: {
    downloads7: number | null; // null until there are daily figures
    downloads30: number | null;
    totals: Partial<Record<ChannelId, number | null>>;
    stars: number | null;
    starsChange7: number | null;
    haInstalls: number | null;
  };
  downloads: Partial<Record<ChannelId, Daily>>;
  stars: Daily;
}

export interface Stats {
  format: number;
  generatedAt: string;
  org: { name: string; github: string };
  snapshotDate: string | null;
  firstSnapshot: string | null;
  pageViewsSince: string | null;
  notes: string[];
  components: Component[];
  websites: Website[];
  community?: CommunityProject[]; // from 0.2.0
}
