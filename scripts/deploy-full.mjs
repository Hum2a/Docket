#!/usr/bin/env node
/**
 * Production rollout: merge local env keys, sync secrets, migrate, deploy.
 *
 *   npm run deploy:full
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;

const steps = [
  { label: "1/5 Merge missing .dev.vars keys", args: [join(root, "scripts/env-merge.mjs")] },
  { label: "2/5 Sync secrets to Cloudflare", args: [join(root, "scripts/secrets.mjs")] },
  { label: "3/5 Apply pending migrations", args: [join(root, "scripts/db.mjs"), "migrate"] },
  { label: "4/5 Build SPA", args: [join(root, "node_modules/vite/bin/vite.js"), "build"] },
  {
    label: "5/5 wrangler deploy",
    args: [join(root, "node_modules/wrangler/bin/wrangler.js"), "deploy"],
  },
];

function run(label, args) {
  console.log(`\n==> ${label}`);
  return new Promise((resolve, reject) => {
    const child = spawn(node, args, {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed (exit ${code})`));
    });
  });
}

for (const step of steps) {
  await run(step.label, step.args);
}

console.log("\ndeploy:full complete");
