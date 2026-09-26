import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const readJson = async file => JSON.parse(await readFile(resolve(root, file), "utf8"));
const fail = message => { throw new Error("Release package check failed: " + message); };
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const appVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const [pkg, manifest, versions] = await Promise.all([
  readJson("package.json"), readJson("manifest.json"), readJson("versions.json")
]);
if (!/^[a-z]+(?:-[a-z]+)*$/.test(manifest.id) || manifest.id.endsWith("plugin") ||
    manifest.id.includes("obsidian")) fail("manifest id must use lowercase letters/hyphens and meet Obsidian naming rules");
if (typeof manifest.name !== "string" || !manifest.name.trim()) fail("manifest name is required");
if (!semver.test(manifest.version)) fail("manifest version must use x.y.z");
if (pkg.version !== manifest.version) fail("package.json and manifest.json versions must match");
if (typeof manifest.minAppVersion !== "string" || !appVersion.test(manifest.minAppVersion)) {
  fail("manifest minAppVersion must be a valid version");
}
if (typeof manifest.description !== "string" || !manifest.description.endsWith(".") ||
    manifest.description.length > 250) fail("manifest description must be a short sentence ending in a period");
if (typeof manifest.author !== "string" || !manifest.author.trim() ||
    typeof manifest.isDesktopOnly !== "boolean") fail("manifest author and isDesktopOnly are required");
if (!versions || typeof versions !== "object" || Array.isArray(versions)) fail("versions.json must be an object");
for (const [version, minimum] of Object.entries(versions)) {
  if (!semver.test(version) || typeof minimum !== "string" || !appVersion.test(minimum)) {
    fail("versions.json must map x.y.z plugin versions to valid Obsidian versions");
  }
}
if (versions[manifest.version] !== undefined && versions[manifest.version] !== manifest.minAppVersion) {
  fail("current versions.json entry must match manifest minAppVersion");
}
if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== manifest.version) {
  fail("tag " + process.env.RELEASE_TAG + " does not match manifest version " + manifest.version);
}

const assets = ["main.js", "manifest.json", "styles.css"];
await Promise.all(assets.map(async asset => {
  const contents = await readFile(resolve(root, asset), "utf8").catch(() => fail("missing " + asset + "; run npm run build first"));
  if (!contents.trim()) fail(asset + " is empty");
}));

if (!process.argv.includes("--check")) {
  const output = resolve(root, "release", manifest.id + "-" + manifest.version);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await Promise.all(assets.map(asset => cp(resolve(root, asset), resolve(output, asset))));
  console.log("Release assets staged in " + output);
}
