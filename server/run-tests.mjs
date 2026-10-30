// Runs every test-*.js file (and test.js) at the same time and prints a short summary.
// Most tests spend their time waiting on timers, so in parallel the whole suite takes seconds, not a minute.
// Usage: node run-tests.mjs            all tests
//        node run-tests.mjs jarvis brain   only files whose name contains one of the words
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const only = process.argv.slice(2);
const files = readdirSync(dir).filter((f) => /^test(-[\w-]+)?\.js$/.test(f)).filter((f) => !only.length || only.some((w) => f.includes(w))).sort();
const LIMIT_MS = 120_000;
const t0 = Date.now();

const run = (f) => new Promise((done) => {
  const started = Date.now();
  const p = spawn(process.execPath, [f], { cwd: dir, env: { ...process.env, NODE_ENV: "test" } });
  let out = "";
  p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { out += d; });
  const timer = setTimeout(() => { out += `\n[killed after ${LIMIT_MS / 1000}s]`; p.kill("SIGKILL"); }, LIMIT_MS);
  p.on("close", (code) => { clearTimeout(timer); done({ f, code, out, secs: ((Date.now() - started) / 1000).toFixed(1) }); });
});

const results = await Promise.all(files.map(run));
const failed = results.filter((r) => r.code !== 0);
for (const r of results) console.log(`${r.code === 0 ? "ok  " : "FAIL"} ${r.f.padEnd(24)} ${r.secs}s`);
for (const r of failed) console.log(`\n----- ${r.f} (exit ${r.code}) -----\n${r.out.trim().split("\n").slice(-25).join("\n")}`);
console.log(`\n${results.length - failed.length}/${results.length} passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(failed.length ? 1 : 0);
