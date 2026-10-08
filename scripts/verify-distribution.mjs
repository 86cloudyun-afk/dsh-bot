import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, ".."),
  manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")),
  artifact = resolve(process.argv[2] ?? join(root, "dist", `${manifest.name}-${manifest.version}.tgz`)),
  expected = (await readFile(join(root, "dist/SHA256SUMS"), "utf8")).trim(),
  sha256 = createHash("sha256").update(await readFile(artifact)).digest("hex");
assert.equal(expected, `${sha256}  ${basename(artifact)}`, "Frozen distribution checksum changed");
const packed = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
}))[0];
const files = packed.files.map(file => file.path).sort(),
  entries = execFileSync("tar", ["-tzf", artifact], { encoding: "utf8" }).trim().split("\n").sort();
assert.ok(files.includes("LICENSE"), "Distribution must include its license");
assert.ok(files.every(file => !file.split("/").includes("..") && !file.startsWith("/")));
assert.deepEqual(entries, files.map(file => `package/${file}`).sort(), "Distribution file set differs from the native package allowlist");
for (const file of files) {
  const bytes = execFileSync("tar", ["-xzOf", artifact, `package/${file}`], { maxBuffer: 4 * 1024 * 1024 });
  assert.deepEqual(bytes, await readFile(join(root, file)), `Frozen distribution is stale: ${file}`);
}
console.log(JSON.stringify({ artifact: basename(artifact), sha256, sourceFiles: files.length, sourceFilesMatch: true, licensePresent: true }));
