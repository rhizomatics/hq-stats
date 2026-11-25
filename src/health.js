// Platform health: how each product rates on its platform's own quality measure, collected with the usage figures.
//
//   homeassistant  Home Assistant's Integration Quality Scale, for each `homeassistant_marketplace_integration`
//                  artefact with a `domain`: the level its manifest.json declares (`quality_scale`), and the level
//                  its quality_scale.yaml adds up to - the highest tier whose rules, per hassfest's list, are all
//                  `done` or `exempt` - with the rules still to do for the next tier.
//   signalk        The SignalK plugin registry's scoring (https://signalk.org/signalk-plugin-registry/), for each
//                  `npm` artefact the registry lists: score out of 100, badges, test status and plugin-ci status, for
//                  the latest stable version it has scored.
//
// Neither uses the GitHub API: files come from raw.githubusercontent.com and the registry's published index, so
// collecting health costs no API allowance. A failed source is recorded as { error }, like any other channel.

import { get } from "./http.js";

export const HASSFEST_RULES = "https://raw.githubusercontent.com/home-assistant/core/HEAD/script/hassfest/quality_scale.py";
export const SIGNALK_REGISTRY = "https://signalk.org/signalk-plugin-registry/index.json";
export const TIERS = ["bronze", "silver", "gold", "platinum"];
const DONE = new Set(["done", "exempt"]);

// Each rule's tier, from hassfest's `Rule("<name>", ScaledQualityScaleTiers.<TIER>, ...)` list.
export function parseHassfestRules(source) {
  const rules = {};
  for (const [, name, tier] of source.matchAll(/Rule\(\s*"([^"]+)",\s*ScaledQualityScaleTiers\.(\w+)/g)) rules[name] = tier.toLowerCase();
  if (!Object.keys(rules).length) throw new Error("no rules found in hassfest's quality_scale.py");
  return rules;
}

// A quality_scale.yaml's rule statuses: `  rule: status`, or `  rule:` with `    status: x` below it. Comments
// and block text are ignored.
export function parseQualityScale(yaml) {
  const status = {};
  let current = null;
  for (const line of yaml.split("\n")) {
    const rule = line.match(/^ {2}([a-z0-9-]+):\s*([a-z-]+)?\s*(#.*)?$/);
    if (rule) {
      current = rule[1];
      if (rule[2]) status[current] = rule[2];
      continue;
    }
    const nested = line.match(/^ {4}status:\s*([a-z-]+)/);
    if (nested && current) status[current] = nested[1];
  }
  return status;
}

// The highest tier whose rules are all done or exempt (null below bronze), and what's left for the next one.
export function assess(rules, status) {
  let level = null;
  for (const tier of TIERS) {
    const todo = Object.entries(rules)
      .filter(([name, t]) => t === tier && !DONE.has(status[name]))
      .map(([name]) => name)
      .sort();
    if (todo.length) return { assessed: level, next: { tier, todo } };
    level = tier;
  }
  return { assessed: level, next: null };
}

const raw = (org, repo, file) => `https://raw.githubusercontent.com/${org}/${repo}/HEAD/${file}`;

async function homeAssistant(org, repo, domain, rules) {
  const dir = `custom_components/${domain}`;
  const manifest = JSON.parse(await get(raw(org, repo, `${dir}/manifest.json`), { raw: true }));
  const declared = manifest.quality_scale ?? null;
  let yaml = null;
  try {
    yaml = await get(raw(org, repo, `${dir}/quality_scale.yaml`), { raw: true });
  } catch {
    // no self-assessment: only the declared level
  }
  const out = { domain, declared, assessment_url: yaml ? `https://github.com/${org}/${repo}/blob/HEAD/${dir}/quality_scale.yaml` : null };
  if (yaml && rules) Object.assign(out, assess(rules, parseQualityScale(yaml)));
  return out;
}

function signalK(index, pkg) {
  const p = index.plugins.find((x) => x.name === pkg);
  if (!p) return null;
  return {
    package: pkg,
    version: p.version ?? null,
    score: p.composite_stable ?? null,
    badges: p.badges_stable ?? [],
    test_status: p.test_status ?? null,
    plugin_ci: p.plugin_ci?.status ?? null,
    last_tested: p.last_tested ?? null,
    url: `https://signalk.org/signalk-plugin-registry/#${encodeURIComponent(pkg)}`,
  };
}

// The shared sources, fetched once per run. Each is { error } if it couldn't be read.
export async function healthSources(products) {
  const artefacts = products.flatMap((p) => p.artefacts);
  const safe = async (fn) => {
    try {
      return await fn();
    } catch (e) {
      return { error: e.message };
    }
  };
  const needsHa = artefacts.some((a) => a.distribution === "homeassistant_marketplace_integration" && a.domain);
  const needsSk = artefacts.some((a) => a.distribution === "npm");
  return {
    rules: needsHa ? await safe(async () => parseHassfestRules(await get(HASSFEST_RULES, { raw: true }))) : null,
    registry: needsSk ? await safe(() => get(SIGNALK_REGISTRY)) : null,
  };
}

// A product's health entry, or null when it has nothing a platform rates.
export async function productHealth(org, repo, product, sources) {
  const out = {};
  const integration = product.artefacts.find((a) => a.distribution === "homeassistant_marketplace_integration" && a.domain);
  if (integration) {
    const rules = sources.rules && !sources.rules.error ? sources.rules : null;
    try {
      out.homeassistant = await homeAssistant(org, repo, integration.domain, rules);
      if (sources.rules?.error) out.homeassistant.assessment_error = sources.rules.error;
    } catch (e) {
      out.homeassistant = { error: e.message };
    }
  }
  if (sources.registry && !sources.registry.error) {
    for (const a of product.artefacts.filter((x) => x.distribution === "npm" && x.package)) {
      const sk = signalK(sources.registry, a.package);
      if (sk) {
        out.signalk = sk;
        break;
      }
    }
  } else if (sources.registry?.error && product.platforms?.includes("signalk")) {
    out.signalk = { error: sources.registry.error };
  }
  return Object.keys(out).length ? out : null;
}
