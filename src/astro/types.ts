// The public aggregate `hq-stats build` writes (stats.json), format 1. Documented in docs/data-format.md.
// Dates are YYYY-MM-DD (UTC); a Daily maps a date to that day's figure.

export type Daily = Record<string, number>;
export type Traffic = Record<string, { count: number; uniques: number }>;
export type ChannelId = "hacs" | "npm" | "pypi" | "ghcr";

export interface Component {
  id: string;
  family: string | null;
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
  family: string | null;
  product: boolean;
  description: string;
  analytics: string;
  daily: Daily;
  views7: number | null;
  views30: number | null;
  topPages: { path: string; title: string; count: number }[];
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
}
