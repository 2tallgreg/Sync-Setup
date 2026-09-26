import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const readJson = async file => JSON.parse(await readFile(resolve(root, file), "utf8"));
const pkg = await readJson("package.json");
const manifest = await readJson("manifest.json");
const versions = await readJson("versions.json");
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
if (!semver.test(pkg.version)) throw new Error("package.json version must use x.y.z");
if (typeof manifest.minAppVersion !== "string" || !manifest.minAppVersion) {
  throw new Error("manifest minAppVersion is required before bumping a release");
}
manifest.version = pkg.version;
versions[pkg.version] = manifest.minAppVersion;
await Promise.all([
  writeFile(resolve(root, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n"),
  writeFile(resolve(root, "versions.json"), JSON.stringify(versions, null, 2) + "\n")
]);
