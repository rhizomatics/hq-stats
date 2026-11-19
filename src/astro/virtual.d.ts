/// <reference types="astro/client" />

declare module "virtual:hq-stats" {
  export const stats: unknown;
  export const config: {
    base: string;
    org: { name: string; github: string };
    families: [string, string][];
    metaLabel: string;
  };
}
