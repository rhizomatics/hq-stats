/// <reference types="astro/client" />

declare module "virtual:hq-stats" {
  export const stats: unknown;
  export const config: {
    base: string;
    org: { name: string; github: string };
    lines: [string, string][];
    orgLines: [string, string][];
  };
}
