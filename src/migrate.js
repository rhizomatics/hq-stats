// `hq-stats migrate`: write hq.toml, products.toml and community.toml from a repos.toml.
//
// The mapping is `reposTomlToLayout` (src/config.js), the same one hq-stats uses to read a repos.toml, so the
// migrated files give exactly the model the old file did. Comments aren't carried over. repos.toml is left in
// place; hq.toml is read first once it exists, so delete repos.toml when you're happy with the new files.

import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { LAYOUT, findConfig, fromLayout, isTable, reposTomlToLayout } from "./config.js";

const BARE = /^[A-Za-z0-9_-]+$/;
const WIDTH = 120;

export const tomlKey = (k) => (BARE.test(k) ? k : JSON.stringify(k));

// A value on one line. JSON's string escapes are all valid in TOML basic strings.
export function inline(v) {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return `[${v.map(inline).join(", ")}]`;
  if (isTable(v)) {
    const entries = Object.entries(v);
    return entries.length ? `{ ${entries.map(([k, x]) => `${tomlKey(k)} = ${inline(x)}`).join(", ")} }` : "{}";
  }
  throw new Error(`can't write ${typeof v} as TOML`);
}

// `key = value`, with a long array split one element per line.
function assignment(k, v) {
  const one = `${tomlKey(k)} = ${inline(v)}`;
  if (one.length <= WIDTH || !Array.isArray(v)) return [one];
  return [`${tomlKey(k)} = [`, ...v.map((x) => `  ${inline(x)},`), "]"];
}

const isTableArray = (v) => Array.isArray(v) && v.length > 0 && v.every(isTable);

// A whole document: scalars and arrays as assignments, tables as [sections] (a table of tables only as its
// sub-sections), top-level arrays of tables as [[sections]]; deeper arrays of tables stay inline.
export function stringifyDoc(doc) {
  const out = [];
  const emit = (keys, table) => {
    const entries = Object.entries(table);
    const values = entries.filter(([, v]) => !isTable(v) && !(keys.length === 0 && isTableArray(v)));
    const tables = entries.filter(([, v]) => isTable(v));
    if (keys.length && (values.length || !tables.length)) {
      out.push("", `[${keys.map(tomlKey).join(".")}]`);
    }
    for (const [k, v] of values) out.push(...assignment(k, v));
    for (const [k, v] of tables) emit([...keys, k], v);
    if (keys.length === 0) {
      for (const [k, list] of entries.filter(([, v]) => isTableArray(v))) {
        for (const item of list) {
          out.push("", `[[${tomlKey(k)}]]`);
          for (const [ik, iv] of Object.entries(item)) out.push(...assignment(ik, iv));
        }
      }
    }
  };
  emit([], doc);
  return `${out.join("\n").replace(/^\n+/, "")}\n`;
}

// products.toml or community.toml: one table per entry, fields as assignments, each artefact as
// `artefacts.<name> = ...` when it fits on a line, else its own [<entry>.artefacts.<name>] table after the entry.
export function stringifyEntries(entries) {
  const out = [];
  for (const [id, entry] of Object.entries(entries)) {
    out.push("", `[${tomlKey(id)}]`);
    const { artefacts = {}, ...fields } = entry;
    for (const [k, v] of Object.entries(fields)) out.push(...assignment(k, v));
    const long = [];
    for (const [name, a] of Object.entries(artefacts)) {
      const line = `artefacts.${tomlKey(name)} = ${inline(a)}`;
      if (line.length <= WIDTH || !isTable(a)) out.push(line);
      else long.push([name, a]);
    }
    for (const [name, a] of long) {
      out.push("", `[${tomlKey(id)}.artefacts.${tomlKey(name)}]`);
      for (const [k, v] of Object.entries(a)) out.push(...assignment(k, v));
    }
  }
  return `${out.join("\n").replace(/^\n+/, "")}\n`;
}

const HEADER = (what) =>
  `# ${what}\n# Written by \`hq-stats migrate\` from repos.toml; fields: https://github.com/rhizomatics/hq-stats#configuration\n\n`;

// The three files' text from a parsed repos.toml.
export function migrateText(registry) {
  const layout = reposTomlToLayout(registry);
  fromLayout(layout); // fails here, not on the next run, if the result wouldn't load
  const files = {
    [LAYOUT.hq]: HEADER("The org, its product lines and platforms, and stats settings.") + stringifyDoc(layout.hq),
    [LAYOUT.products]: HEADER("One table per product, keyed by its slug.") + stringifyEntries(layout.products),
  };
  if (Object.keys(layout.community).length) {
    files[LAYOUT.community] = HEADER("Projects and blogs other people build on the products.") + stringifyEntries(layout.community);
  }
  return files;
}

export async function migrate({ config, out, force = false, log = console.log } = {}) {
  const found = findConfig(config);
  if (found.layout !== "repos") {
    throw new Error(
      `${found.dir} already has ${LAYOUT.hq}; pass --config <path to repos.toml> to migrate again (with --force to overwrite)`,
    );
  }
  const files = migrateText(parseToml(readFileSync(found.file, "utf8")));
  const dir = path.resolve(out ?? found.dir);
  const existing = Object.keys(files).filter((f) => existsSync(path.join(dir, f)));
  if (existing.length && !force) throw new Error(`${existing.join(", ")} already in ${dir}; pass --force to overwrite`);
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(dir, name), text);
  const relative = path.relative(process.cwd(), dir);
  const shown = relative.startsWith("..") ? dir : relative || ".";
  log(`wrote ${Object.keys(files).join(", ")} in ${shown} from ${path.basename(found.file)}.`);
  log(`Check them (comments aren't carried over), then delete ${path.basename(found.file)}: ${LAYOUT.hq} is read first from now on.`);
  return { dir, files: Object.keys(files) };
}
