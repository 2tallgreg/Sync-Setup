import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const responses = new Map<string, unknown>();
// Exercise the actual adapter and operation guard without requiring Obsidian's desktop runtime.
const runtime = build({
  entryPoints: ["main.ts", "obsidian-adapter.ts"], bundle: true, write: false,
  outdir: "runtime-test", platform: "node", format: "cjs", external: ["obsidian"]
}).then(result => {
  const modules = result.outputFiles.map(file => {
    const module = { exports: {} };
    const obsidian = {
      Plugin: class {}, Modal: class {}, PluginSettingTab: class {},
      Platform: { isMobileApp: true }, requireApiVersion: () => true,
      requestUrl: async (url: string) => {
        if (!responses.has(url)) throw new Error(`Unexpected request: ${url}`);
        return { json: responses.get(url) };
      }
    };
    new Function("require", "module", "exports", file.text)(
      (id: string) => { assert.equal(id, "obsidian"); return obsidian; }, module, module.exports
    );
    return [file.path.endsWith("obsidian-adapter.js") ? "adapter" : "main", module.exports];
  });
  return Object.fromEntries(modules) as {
    adapter: typeof import("../obsidian-adapter"); main: typeof import("../main");
  };
});

test("adapter detects silent state-change failures and blocks self-management", async () => {
  const { adapter } = await runtime;
  const enabledPlugins = new Set<string>();
  const manager = {
    manifests: { calendar: { id: "calendar", name: "Calendar", version: "1.0.0" } },
    enabledPlugins,
    enablePluginAndSave: async (id: string): Promise<void | boolean> => { assert.equal(id, "calendar"); },
    disablePluginAndSave: async (id: string) => { assert.equal(id, "calendar"); },
    installPlugin: async () => { throw new Error("must not be called"); }
  };
  const bridge = new adapter.ObsidianPlugins({ plugins: manager } as unknown as import("obsidian").App);
  await assert.rejects(bridge.setEnabled("calendar", true), /did not enable/);
  manager.enablePluginAndSave = async id => { enabledPlugins.add(id); };
  await bridge.setEnabled("calendar", true);
  await assert.rejects(bridge.setEnabled("calendar", false), /did not disable/);
  manager.disablePluginAndSave = async id => { enabledPlugins.delete(id); };
  await bridge.setEnabled("calendar", false);
  manager.enablePluginAndSave = async id => { enabledPlugins.add(id); return false; };
  await assert.rejects(bridge.setEnabled("calendar", true), /did not enable/);
  await assert.rejects(bridge.setEnabled("obsyncdian", false), /cannot manage itself/);
  await assert.rejects(bridge.install({ id: "obsyncdian", repo: "owner/repo",
    manifest: { id: "obsyncdian", name: "Sync Setup", version: "1.0.0" } }), /cannot manage itself/);
});

test("overlapping writes are rejected and the guard recovers after a failure", async () => {
  const { main } = await runtime;
  const plugin = new main.default(null!, null!) as unknown as {
    applyChanges: (work: () => Promise<void>) => Promise<void>;
  };
  let finish!: () => void;
  const first = plugin.applyChanges(() => new Promise<void>(resolve => { finish = resolve; }));
  let secondRan = false;
  await assert.rejects(plugin.applyChanges(async () => { secondRan = true; }), /still being applied/);
  assert.equal(secondRan, false);
  finish();
  await first;
  await assert.rejects(plugin.applyChanges(async () => { throw new Error("write failed"); }), /write failed/);
  await plugin.applyChanges(async () => { secondRan = true; });
  assert.equal(secondRan, true);
});

test("mobile install discovery skips desktop-only and malformed compatibility metadata", async () => {
  const { adapter } = await runtime;
  responses.set("https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugins.json",
    [{ id: "calendar", repo: "owner/calendar" }]);
  const bridge = new adapter.ObsidianPlugins({ plugins: { installPlugin: async () => {} } } as unknown as import("obsidian").App);
  const entry = { name: "Calendar", enabled: true, scope: "everywhere" as const, desktopOnly: false };
  for (const [isDesktopOnly, minAppVersion, expected] of [
    [true, "1.0.0", false], ["true", "1.0.0", false], [false, 42, false], [false, "1.0.0", true]
  ] as const) {
    responses.set("https://raw.githubusercontent.com/owner/calendar/HEAD/manifest.json", {
      id: "calendar", name: "Calendar", version: "1.0.0", minAppVersion, isDesktopOnly
    });
    assert.equal((await bridge.findInstallCandidates([["calendar", entry]])).has("calendar"), expected);
  }
  responses.clear();
});
