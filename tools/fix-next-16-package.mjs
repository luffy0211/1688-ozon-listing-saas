import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(join(process.cwd(), "package.json"));
const nextRoot = dirname(require.resolve("next/package.json"));

for (const [relativePath, content] of [
  ["dist/compiled/server-only/empty.js", ""],
  ["font/local/target.css", ""],
]) {
  const file = join(nextRoot, relativePath);
  if (existsSync(file)) continue;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}
