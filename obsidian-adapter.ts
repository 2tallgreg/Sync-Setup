import { App, Platform, requestUrl, requireApiVersion } from "obsidian";
import type { InstalledPlugin, ProfilePlugin } from "./profile";

type Manifest = { id: string; name: string; version: string; minAppVersion?: string; isDesktopOnly?: boolean };
type Manager = {
  manifests?: Record<string, Manifest>;
  enabledPlugins?: Set<string>;
  enablePluginAndSave?: (id: string) => Promise<void>;
  disablePluginAndSave?: (id: string) => Promise<void>;
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
    const method = enabled ? this.manager?.enablePluginAndSave : this.manager?.disablePluginAndSave;
    if (!method) throw new Error("Obsidian cannot change plugin state here.");
    await method.call(this.manager, id);
  }

  async findInstallCandidates(entries: Array<[string, ProfilePlugin]>): Promise<Map<string, InstallCandidate>> {
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
    for (const [id] of entries) {
      const repo = directory.get(id);
      if (!repo) continue;
      try {
        const result = await requestUrl(`https://raw.githubusercontent.com/${repo}/HEAD/manifest.json`);
        const manifest: unknown = result.json;
        if (!manifest || typeof manifest !== "object") continue;
        const m = manifest as Manifest;
        if (m.id !== id || typeof m.version !== "string" || !m.version ||
            typeof m.name !== "string" || !m.name ||
            (m.minAppVersion && !requireApiVersion(m.minAppVersion)) ||
            (Platform.isMobileApp && m.isDesktopOnly === true)) continue;
        candidates.set(id, { id, repo, manifest: m });
      } catch { /* A missing or unreachable manifest stays in the skipped group. */ }
    }
    return candidates;
  }

  async install(candidate: InstallCandidate): Promise<void> {
    if (!this.manager?.installPlugin) throw new Error("Plugin installation is unavailable.");
    await this.manager.installPlugin(candidate.repo, candidate.manifest.version, candidate.manifest);
  }
}
