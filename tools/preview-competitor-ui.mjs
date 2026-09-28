import { createServer } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const repo = fileURLToPath(new URL("../", import.meta.url));
const web = createRequire(new URL("../apps/web/package.json", import.meta.url));
const server = await createServer({
  configFile: false,
  root: `${repo}/tests/ui`,
  esbuild: { jsx: "automatic" },
  resolve: { alias: {
    "@": `${repo}/apps/web/src`,
    "react": dirname(web.resolve("react")),
    "react-dom/client": web.resolve("react-dom/client"),
  } },
  css: { postcss: { plugins: [web("tailwindcss")({
    content: [`${repo}/apps/web/src/components/**/*.{ts,tsx}`, `${repo}/tests/ui/*.tsx`],
    theme: { extend: {} }, plugins: [],
  }), web("autoprefixer")()] } },
  server: { host: "127.0.0.1", port: 5179, fs: { allow: [repo] } },
});
await server.listen();
server.printUrls();
