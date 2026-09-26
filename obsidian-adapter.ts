import { App, Platform, requestUrl, requireApiVersion } from "obsidian";
import type { InstalledPlugin, ProfilePlugin } from "./profile";
import { mapConcurrent, selectCompatibleRelease } from "./install-candidates";

type Manifest = { id: string; name: string; version: string; minAppVersion?: string; isDesktopOnly?: boolean };
type Manager = {
  manifests?: Record<string, Manifest>;
  enabledPlugins?: Set<string>;
  enablePluginAndSave?: (id: string) => Promise<void | boolean>;
  disablePluginAndSave?: (id: string) => Promise<void | boolean>;
  installPlugin?: (repo: string, version: string, manifest: Manifest) => Promise<void>;
};
type AppWithManager = App & { plugins?: Manager };
type Listing = { id: string; repo: string };
export interface InstallCandidate { id: string; repo: string; manifest: Manifest }

/** All undocumented Obsidian plugin-manager access lives here. */
export class ObsidianPlugins {
  private get manager(): Manager | undefined { return (this.app as AppWithManager).plugins; }
  constructor(private app: App) {}

  inventory(): InstalledPlugin[] {
    const manager = this.manager;
    if (!manager?.manifests || !(manager.enabledPlugins instanceof Set)) {
      throw new Error("Obsidian's plugin inventory is unavailable on this device.");
    }
    return Object.entries(manager.manifests).filter(([id]) => id !== "obsyncdian")
      .map(([id, manifest]) => ({
        id, name: manifest.name || id, enabled: manager.enabledPlugins!.has(id),
        desktopOnly: manifest.isDesktopOnly === true
      })).sort((a, b) => a.name.localeCompare(b.name));
  }

  canChangeState(): boolean {
    return typeof this.manager?.enablePluginAndSave === "function" &&
      typeof this.manager?.disablePluginAndSave === "function";
  }
  canInstall(): boolean { return typeof this.manager?.installPlugin === "function"; }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    if (id === "obsyncdian") throw new Error("Obsyncdian cannot manage itself.");
    const method = enabled ? this.manager?.enablePluginAndSave : this.manager?.disablePluginAndSave;
    if (!method) throw new Error("Obsidian cannot change plugin state here.");
    const result = await method.call(this.manager, id);
    const plugin = this.inventory().find(plugin => plugin.id === id);
    if (result === false || !plugin || plugin.enabled !== enabled) {
      throw new Error(`Obsidian did not ${enabled ? "enable" : "disable"} ${id}.`);
    }
  }

  async findInstallCandidates(
    entries: Array<[string, ProfilePlugin]>, onProgress?: (completed: number, total: number) => void
  ): Promise<Map<string, InstallCandidate>> {
    const candidates = new Map<string, InstallCandidate>();
    if (!entries.length || !this.canInstall()) return candidates;
    const response = await requestUrl("https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugins.json");
    const listing: unknown = response.json;
    if (!Array.isArray(listing)) throw new Error("Community plugin directory is unavailable.");
    const directory = new Map<string, string>();
    for (const item of listing as Listing[]) {
      if (typeof item?.id === "string" && typeof item.repo === "string" &&
          /^[\w.-]+\/[\w.-]+$/.test(item.repo)) directory.set(item.id, item.repo);
    }
    let completed = 0;
    const found = await mapConcurrent(entries, 4, async ([id]) => {
      const repo = directory.get(id);
      if (!repo) {
        onProgress?.(++completed, entries.length);
        return undefined;
      }
      try {
        let result = await requestUrl(`https://raw.githubusercontent.com/${repo}/HEAD/manifest.json`);
        const manifest: unknown = result.json;
        if (manifest && typeof manifest === "object" &&
            !supportsManifest(manifest as Manifest, id)) {
          const versionsResponse = await requestUrl(`https://raw.githubusercontent.com/${repo}/HEAD/versions.json`);
          const release = selectCompatibleRelease(versionsResponse.json, requireApiVersion);
          if (!release) return undefined;
          result = await requestUrl(`https://raw.githubusercontent.com/${repo}/${release}/manifest.json`);
        }
        const m: unknown = result.json;
        if (!m || typeof m !== "object" || !supportsManifest(m as Manifest, id) ||
            (Platform.isMobileApp && (m as Manifest).isDesktopOnly === true)) return undefined;
        return { id, repo, manifest: m as Manifest };
      } catch { /* Missing or unreachable per-plugin metadata stays skipped. */
        return undefined;
      } finally {
        onProgress?.(++completed, entries.length);
      }
    });
    for (const candidate of found) if (candidate) candidates.set(candidate.id, candidate);
    return candidates;
  }

  async install(candidate: InstallCandidate): Promise<void> {
    if (candidate.id === "obsyncdian") throw new Error("Obsyncdian cannot manage itself.");
    if (!this.manager?.installPlugin) throw new Error("Plugin installation is unavailable.");
    await this.manager.installPlugin(candidate.repo, candidate.manifest.version, candidate.manifest);
  }
}

function supportsManifest(manifest: Manifest, id: string): boolean {
  return manifest.id === id && typeof manifest.version === "string" && !!manifest.version &&
    typeof manifest.name === "string" && !!manifest.name &&
    (manifest.isDesktopOnly === undefined || typeof manifest.isDesktopOnly === "boolean") &&
    (manifest.minAppVersion === undefined ||
      (typeof manifest.minAppVersion === "string" && !!manifest.minAppVersion && requireApiVersion(manifest.minAppVersion)));
}
