import { App, Notice, Platform, Plugin, PluginSettingTab, Setting } from "obsidian";

type PluginScope = "everywhere" | "desktop" | "mobile" | "local";
interface ProfilePlugin { enabled: boolean; scope: PluginScope; syncSettings: boolean; }
interface SyncProfile { schemaVersion: 1; updatedAt: string; sourceDevice: string; plugins: Record<string, ProfilePlugin>; }
interface Settings { deviceName: string; profilePath: string; }
const DEFAULTS: Settings = { deviceName: "", profilePath: ".obsidian/obsyncdian-profile.json" };

type InternalPlugins = { manifests?: Record<string, unknown>; enabledPlugins?: Set<string> };
type AppWithPlugins = App & { plugins?: InternalPlugins };

export default class Obsyncdian extends Plugin {
  settings: Settings = DEFAULTS;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new ObsyncdianSettings(this.app, this));
    this.addCommand({ id: "capture-profile", name: "Use this device as profile source", callback: () => void this.capture() });
    this.addCommand({ id: "compare-profile", name: "Compare this device with profile", callback: () => void this.compare() });
  }

  private localPlugins(): Record<string, boolean> {
    const manager = (this.app as AppWithPlugins).plugins;
    const enabled = manager?.enabledPlugins ?? new Set<string>();
    return Object.fromEntries(Object.keys(manager?.manifests ?? {})
      .filter(id => id !== this.manifest.id).sort().map(id => [id, enabled.has(id)]));
  }

  async capture(): Promise<void> {
    const local = this.localPlugins();
    const profile: SyncProfile = {
      schemaVersion: 1, updatedAt: new Date().toISOString(),
      sourceDevice: this.settings.deviceName || (Platform.isMobileApp ? "Mobile device" : "Desktop device"),
      plugins: Object.fromEntries(Object.entries(local).map(([id, enabled]) => [id, { enabled, scope: "everywhere" as PluginScope, syncSettings: false }]))
    };
    await this.ensureParent(this.settings.profilePath);
    await this.app.vault.adapter.write(this.settings.profilePath, JSON.stringify(profile, null, 2) + "\n");
    new Notice(`Obsyncdian captured ${Object.keys(profile.plugins).length} plugins.`);
  }

  async compare(): Promise<void> {
    if (!(await this.app.vault.adapter.exists(this.settings.profilePath))) {
      new Notice("Obsyncdian profile not found. Capture a source device first."); return;
    }
    let profile: SyncProfile;
    try { profile = JSON.parse(await this.app.vault.adapter.read(this.settings.profilePath)) as SyncProfile; }
    catch { new Notice("Obsyncdian profile is not valid JSON."); return; }
    if (profile.schemaVersion !== 1 || !profile.plugins) { new Notice("Obsyncdian profile format is unsupported."); return; }

    const local = this.localPlugins();
    const desired = Object.entries(profile.plugins).filter(([, p]) => this.applies(p.scope));
    const missing = desired.filter(([id]) => !(id in local)).map(([id]) => id);
    const drift = desired.filter(([id, p]) => id in local && local[id] !== p.enabled).map(([id]) => id);
    if (!missing.length && !drift.length) { new Notice("Obsyncdian: this device matches the plugin profile."); return; }
    new Notice(`Obsyncdian: ${missing.length} missing, ${drift.length} enabled-state differences. No changes applied.`);
  }

  private applies(scope: PluginScope): boolean {
    return scope === "everywhere" || (scope === "desktop" && Platform.isDesktopApp) || (scope === "mobile" && Platform.isMobileApp);
  }

  private async ensureParent(path: string): Promise<void> {
    const parts = path.split("/"); parts.pop(); let current = "";
    for (const part of parts) { current = current ? `${current}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(current))) await this.app.vault.adapter.mkdir(current);
    }
  }

  async loadSettings(): Promise<void> { this.settings = Object.assign({}, DEFAULTS, await this.loadData()); }
  async saveSettings(): Promise<void> { await this.saveData(this.settings); }
}

class ObsyncdianSettings extends PluginSettingTab {
  constructor(app: App, private plugin: Obsyncdian) { super(app, plugin); }
  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl).setName("Device name").setDesc("Friendly name recorded when this device writes the profile.")
      .addText(t => t.setPlaceholder(Platform.isMobileApp ? "My iPhone" : "My MacBook").setValue(this.plugin.settings.deviceName)
        .onChange(async v => { this.plugin.settings.deviceName = v.trim(); await this.plugin.saveSettings(); }));
    new Setting(this.containerEl).setName("Profile path").setDesc("Shared profile path inside this vault.")
      .addText(t => t.setValue(this.plugin.settings.profilePath)
        .onChange(async v => { this.plugin.settings.profilePath = v.trim() || DEFAULTS.profilePath; await this.plugin.saveSettings(); }));
    new Setting(this.containerEl).setName("Capture profile").setDesc("Use this device's current plugin inventory as the shared profile.")
      .addButton(b => b.setButtonText("Use this device").onClick(() => void this.plugin.capture()));
    new Setting(this.containerEl).setName("Check for drift").setDesc("Compare this device with the profile without changing anything.")
      .addButton(b => b.setButtonText("Compare").onClick(() => void this.plugin.compare()));
  }
}
