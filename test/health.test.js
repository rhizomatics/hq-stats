import assert from "node:assert/strict";
import { test } from "node:test";
import { assess, parseHassfestRules, parseQualityScale, productHealth } from "../src/health.js";

const HASSFEST = `
ALL_RULES = [
    Rule("config-flow", ScaledQualityScaleTiers.BRONZE, config_flow),
    Rule("runtime-data", ScaledQualityScaleTiers.BRONZE),
    Rule("test-coverage", ScaledQualityScaleTiers.SILVER),
    Rule(
        "diagnostics",
        ScaledQualityScaleTiers.GOLD,
    ),
    Rule("strict-typing", ScaledQualityScaleTiers.PLATINUM),
]`;

const YAML = `rules:
  # Bronze
  config-flow: done
  runtime-data:
    status: exempt
    comment: |
      No runtime data; status: todo in this comment must not count.
  test-coverage: done
  diagnostics:
    status: todo
  strict-typing: done
`;

test("hassfest's rule list gives each rule's tier, multi-line entries included", () => {
  assert.deepEqual(parseHassfestRules(HASSFEST), {
    "config-flow": "bronze",
    "runtime-data": "bronze",
    "test-coverage": "silver",
    diagnostics: "gold",
    "strict-typing": "platinum",
  });
  assert.throws(() => parseHassfestRules("nothing here"), /no rules/);
});

test("quality_scale.yaml statuses, inline or nested, ignoring comment text", () => {
  assert.deepEqual(parseQualityScale(YAML), {
    "config-flow": "done",
    "runtime-data": "exempt",
    "test-coverage": "done",
    diagnostics: "todo",
    "strict-typing": "done",
  });
});

test("the assessed level is the highest tier with every rule done or exempt", () => {
  const rules = parseHassfestRules(HASSFEST);
  assert.deepEqual(assess(rules, parseQualityScale(YAML)), { assessed: "silver", next: { tier: "gold", todo: ["diagnostics"] } });
  assert.deepEqual(assess(rules, { "config-flow": "done" }), { assessed: null, next: { tier: "bronze", todo: ["runtime-data"] } });
  const all = Object.fromEntries(Object.keys(rules).map((r) => [r, "done"]));
  assert.deepEqual(assess(rules, all), { assessed: "platinum", next: null });
});

test("SignalK: a product's npm package found in the registry index; others get nothing", async () => {
  const registry = {
    plugins: [
      {
        name: "@me/signalk-x",
        version: "1.2.0",
        composite_stable: 95,
        badges_stable: ["compatible", "tested"],
        test_status: "passing",
        plugin_ci: { status: "ok" },
        last_tested: "2026-11-20T00:00:00Z",
      },
    ],
  };
  const product = (pkg) => ({ artefacts: [{ distribution: "npm", package: pkg }], platforms: ["signalk"] });
  const h = await productHealth("me", "x", product("@me/signalk-x"), { rules: null, registry });
  assert.deepEqual(
    [h.signalk.score, h.signalk.badges, h.signalk.test_status, h.signalk.plugin_ci, h.signalk.version],
    [95, ["compatible", "tested"], "passing", "ok", "1.2.0"],
  );
  assert.equal(await productHealth("me", "y", product("@me/other"), { rules: null, registry }), null);
  // The registry unreadable: a SignalK product records the error, anything else stays unrated.
  const failed = { rules: null, registry: { error: "HTTP 503" } };
  assert.deepEqual(await productHealth("me", "x", product("@me/signalk-x"), failed), { signalk: { error: "HTTP 503" } });
  assert.equal(await productHealth("me", "z", { artefacts: [{ distribution: "npm", package: "lib" }], platforms: [] }, failed), null);
});
