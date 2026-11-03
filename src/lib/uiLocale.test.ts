// Every text of the admin area and the sign-in pages must be translated into each language.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { UI_LOCALE_CODES } from "./uiLocaleCodes";

const ROOTS = [
  "src/routes/(manage)",
  "src/routes/(account)",
  "src/lib/components/manage",
  "src/lib/components",
  "src/lib/uiLocale.svelte.ts",
];

function files(dir: string, deep = true): string[] {
  if (!fs.existsSync(dir)) return [];
  if (fs.statSync(dir).isFile()) return [dir];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return deep && e.name !== "ui" ? files(full) : [];
    return /\.(svelte|ts)$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [full] : [];
  });
}

/** The keys of tm("…") calls with a literal text. */
export function UsedKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  const seen = new Set<string>();
  for (const root of ROOTS) {
    for (const file of files(root, root !== "src/lib/components")) {
      if (seen.has(file)) continue;
      seen.add(file);
      const source = fs.readFileSync(file, "utf8");
      for (const m of source.matchAll(/\btmh?\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)) {
        const raw = m[1];
        const key = raw.startsWith('"') ? JSON.parse(raw) : raw.slice(1, -1).replace(/\\'/g, "'");
        if (!keys.has(key)) keys.set(key, file);
      }
    }
  }
  return keys;
}

const dictionary = (code: string): Record<string, string> =>
  JSON.parse(fs.readFileSync(`src/lib/locales/manage/${code}.json`, "utf8")).mappings;

describe("admin translations", () => {
  const used = UsedKeys();

  it("finds the texts", () => {
    expect(used.size).toBeGreaterThan(0);
  });

  for (const code of UI_LOCALE_CODES.filter((c) => c !== "en")) {
    it(`has every text in ${code}`, () => {
      const dict = dictionary(code);
      const missing = [...used].filter(([key]) => !dict[key]?.trim()).map(([key, file]) => `${file}: ${key}`);
      expect(missing).toEqual([]);
    });

    it(`keeps the placeholders in ${code}`, () => {
      const dict = dictionary(code);
      const wrong = [...used.keys()]
        .filter((key) => dict[key])
        .filter((key) => {
          const names = (s: string) =>
            [...s.matchAll(/%(\w+)/g)]
              .map((m) => m[1])
              .sort()
              .join(",");
          return names(key) !== names(dict[key]);
        });
      expect(wrong).toEqual([]);
    });
  }
});
