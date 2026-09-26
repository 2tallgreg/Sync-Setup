import { App, Modal, Notice, Platform, Plugin, PluginSettingTab, Setting } from "obsidian";
import { ObsidianPlugins, type InstallCandidate } from "./obsidian-adapter";
import { captureProfile, parseProfile, profileText, type Device, type Profile, type Scope } from "./profile";
import { assertPreviewUnchanged, isAction, reconcile, reviewRestore, type Difference } from "./reconcile";

interface LocalSettings { deviceName: string; showAdvanced: boolean }
const defaults: LocalSettings = { deviceName: "", showAdvanced: false };
const scopeNames: Record<Scope, string> = {
  everywhere: "Everywhere", desktop: "Desktop", mobile: "Mobile", local: "Local only"
};
const displayError = (error: unknown): string => error instanceof Error ? error.message : String(error);

class PreviewModal extends Modal {
  constructor(app: App, title: string, body: (element: HTMLElement) => void,
    action: string, onConfirm: () => Promise<void>, private afterClose?: () => void) {
    super(app);
    this.titleEl.setText(title);
    body(this.contentEl);
    const buttons = new Setting(this.contentEl).addButton(button =>
      button.setButtonText("Cancel").onClick(() => this.close()));
    buttons.addButton(button => button.setButtonText(action).setCta().onClick(async () => {
      button.setDisabled(true);
      try { await onConfirm(); this.close(); }
      catch (error) { new Notice(`Obsyncdian: ${displayError(error)}`, 9000); button.setDisabled(false); }
    }));
  }
  onClose(): void { this.contentEl.empty(); this.afterClose?.(); }
}

class LookupModal extends Modal {
  cancelled = false;
  private completed = false;
  private progressEl: HTMLProgressElement;
  private statusEl: HTMLParagraphElement;
  constructor(app: App, count: number) {
    super(app);
    this.titleEl.setText("Checking for plugins");
    this.statusEl = this.contentEl.createEl("p", { text: `Looking up install options for ${count} missing ${count === 1 ? "plugin" : "plugins"}. This can take a moment.` });
    this.progressEl = this.contentEl.createEl("progress", { cls: "obsyncdian-lookup-progress" });
    this.progressEl.setAttribute("aria-label", "Checking community plugin listings");
    this.progressEl.removeAttribute("value");
    this.contentEl.createEl("p", { text: "No changes are being made. Close this window to stop the restore preview." });
    new Setting(this.contentEl).addButton(button => button.setButtonText("Cancel").onClick(() => this.close()));
  }
  updateProgress(completed: number, total: number): void {
    this.progressEl.max = Math.max(total, 1);
    this.progressEl.value = Math.min(completed, total);
    this.statusEl.setText(`Checking install options · ${Math.min(completed, total)} of ${total}`);
  }
  finish(): void { this.completed = true; this.close(); }
  onClose(): void { this.cancelled = !this.completed; this.contentEl.empty(); }
}

export default class Obsyncdian extends Plugin {
  settings: LocalSettings = { ...defaults };
  private bridge!: ObsidianPlugins;
  private tab!: ObsyncdianSettings;
  private get device(): Device { return Platform.isMobileApp ? "mobile" : "desktop"; }
  private get path(): string { return `${this.app.vault.configDir}/obsyncdian-profile.json`; }

  async onload(): Promise<void> {
    this.bridge = new ObsidianPlugins(this.app);
    this.settings = { ...defaults, ...await this.loadData() as Partial<LocalSettings> };
    this.tab = new ObsyncdianSettings(this.app, this);
    this.addSettingTab(this.tab);
    this.addCommand({ id: "use-device-as-source", name: "Use this device as source",
      callback: () => void this.capturePreview() });
    this.addCommand({ id: "restore-device", name: "Restore this device from profile",
      callback: () => void this.restorePreview() });
    this.addCommand({ id: "compare", name: "Compare device with profile",
      callback: () => void this.compareNotice() });
  }

  async saveSettings(): Promise<void> { await this.saveData(this.settings); }
  private async rawProfile(): Promise<string | null> {
    return await this.app.vault.adapter.exists(this.path) ? this.app.vault.adapter.read(this.path) : null;
  }
  async profile(): Promise<Profile | null> {
    const raw = await this.rawProfile();
    return raw === null ? null : parseProfile(raw);
  }
  inventory() { return this.bridge.inventory(); }
  differences(profile: Profile) { return reconcile(profile, this.inventory(), this.device); }

  async compareNotice(): Promise<void> {
    try {
      const profile = await this.profile();
      if (!profile) return void new Notice("No shared profile yet. Use this device as source to create one.");
      const differences = this.differences(profile);
      const count = (kind: Difference["kind"]) => differences.filter(item => item.kind === kind).length;
      new Notice(`Obsyncdian: ${count("match")} match, ${count("missing")} missing, ${count("enable") + count("disable")} different, ${count("skipped")} skipped.`);
    } catch (error) { new Notice(`Obsyncdian: ${displayError(error)}`, 9000); }
  }

  async capturePreview(changedScope?: { id: string; scope: Scope }): Promise<void> {
    try {
      const before = await this.rawProfile();
      const prior = before === null ? null : parseProfile(before);
      const source = this.settings.deviceName.trim() || (this.device === "mobile" ? "Mobile device" : "Desktop device");
      const proposal = changedScope && prior
        ? { ...prior, updatedAt: new Date().toISOString(),
          plugins: Object.fromEntries(Object.entries(prior.plugins).map(([id, entry]) =>
            [id, id === changedScope.id ? { ...entry, scope: changedScope.scope } : { ...entry }])) }
        : captureProfile(this.inventory(), prior, this.device, source, new Date().toISOString());
      const beforeEntries = prior?.plugins ?? {};
      const added = Object.keys(proposal.plugins).filter(id => !beforeEntries[id]);
      const removed = Object.keys(beforeEntries).filter(id => !proposal.plugins[id]);
      const updated = Object.keys(proposal.plugins).filter(id =>
        beforeEntries[id] && JSON.stringify(beforeEntries[id]) !== JSON.stringify(proposal.plugins[id]));
      new PreviewModal(this.app, "Use this device as source", el => {
        el.createEl("p", { text: `This will write ${this.path} for your vault sync service to carry to other devices.` });
        el.createEl("p", { text: `${added.length} added · ${updated.length} updated · ${removed.length} removed · ${Object.keys(proposal.plugins).length} total` });
        if (added.length) el.createEl("p", { text: `Add: ${added.join(", ")}` });
        if (updated.length) el.createEl("p", { text: `Change: ${updated.join(", ")}` });
        if (removed.length) el.createEl("p", { text: `Remove from profile: ${removed.join(", ")} (does not uninstall anywhere)` });
        el.createEl("p", { text: "Plugin settings and credentials are never copied by this version." });
      }, "Write shared profile", async () => {
        if (await this.rawProfile() !== before) throw new Error("Profile changed since preview. Review it again.");
        if (before !== null) await this.app.vault.adapter.write(
          `${this.app.vault.configDir}/obsyncdian-profile.backup.json`, before
        );
        await this.app.vault.adapter.write(this.path, profileText(proposal));
        new Notice("Obsyncdian profile saved. Your vault sync service can carry it to other devices.");
      }, () => this.refreshSettings()).open();
    } catch (error) { new Notice(`Obsyncdian: ${displayError(error)}`, 9000); }
  }

  async restorePreview(): Promise<void> {
    try {
      const before = await this.rawProfile();
      if (before === null) return void new Notice("No shared profile yet. Capture one on your source device.");
      const profile = parseProfile(before);
      const inventory = this.inventory();
      const changes = reconcile(profile, inventory, this.device);
      const missing = changes.filter(item => item.kind === "missing");
      let candidates = new Map<string, InstallCandidate>();
      let lookupProblem = "";
      if (missing.length) {
        const lookup = new LookupModal(this.app, missing.length);
        lookup.open();
        try {
          candidates = await this.bridge.findInstallCandidates(
            missing.map(item => [item.id, item.entry]),
            (completed, total) => lookup.updateProgress(completed, total)
          );
        } catch (error) { lookupProblem = displayError(error); }
        const wasCancelled = lookup.cancelled;
        lookup.finish();
        if (wasCancelled) return;
      }
      const reviewed = reviewRestore(changes, new Set(candidates.keys()), this.bridge.canChangeState(), lookupProblem || undefined);
      const actions = reviewed.filter(item => isAction(item.kind));
      new PreviewModal(this.app, "Set up this device", el => {
        el.createEl("p", { text: `Profile from ${profile.sourceDevice} · ${this.device} · ${profile.updatedAt}` });
        el.createEl("p", { text: `${actions.length} changes · ${reviewed.filter(i => i.kind === "match").length} matching · ${reviewed.filter(i => i.kind === "skipped").length} skipped` });
        const list = el.createEl("div", { cls: "obsyncdian-preview-list" });
        for (const item of reviewed) {
          const row = list.createEl("div", { cls: "obsyncdian-preview-row" });
          row.createEl("strong", { text: item.entry.name });
          row.createEl("span", { text: ({
            match: "Already matches", missing: `Install · ${item.entry.enabled ? "enable" : "leave disabled"}`,
            enable: "Enable", disable: "Disable", skipped: `Skip · ${item.reason}`
          })[item.kind] });
        }
        el.createEl("p", { text: "No plugins will be uninstalled. Existing plugin settings will not be changed. Obsidian may need a restart after installation." });
      }, actions.length ? "Apply changes" : "Done", async () => {
        assertPreviewUnchanged(before, await this.rawProfile(), inventory, this.inventory());
        let completed = 0;
        const failures: string[] = [];
        for (const item of actions) {
          try {
            if (item.kind === "missing") {
              const candidate = candidates.get(item.id);
              if (!candidate) continue;
              await this.bridge.install(candidate);
              const installed = this.inventory().find(plugin => plugin.id === item.id);
              if (!installed) throw new Error("Obsidian did not report the plugin as installed.");
              if (installed.enabled !== item.entry.enabled) {
                await this.bridge.setEnabled(item.id, item.entry.enabled);
              }
            } else await this.bridge.setEnabled(item.id, item.kind === "enable");
            completed++;
          } catch (error) { failures.push(`${item.id}: ${displayError(error)}`); }
        }
        new Notice(`Obsyncdian: ${completed} changes applied${failures.length ? `; ${failures.length} failed: ${failures.join("; ")}` : "."}`, 12000);
        this.refreshSettings();
      }).open();
    } catch (error) { new Notice(`Obsyncdian: ${displayError(error)}`, 9000); }
  }

  private refreshSettings(): void {
    if (this.tab.containerEl.isConnected) this.tab.display();
  }
}

class ObsyncdianSettings extends PluginSettingTab {
  constructor(app: App, private plugin: Obsyncdian) { super(app, plugin); }
  display(): void {
    const el = this.containerEl;
    el.empty();
    el.addClass("obsyncdian-settings");
    el.createEl("h2", { text: "Obsyncdian" });
    el.createEl("p", { text: "Your plugin setup, carried by your vault." });
    const status = el.createDiv({ cls: "obsyncdian-status" });
    status.setText("Checking this device…");
    void (async () => {
      try {
        const profile = await this.plugin.profile();
        if (!el.isConnected) return;
        if (!profile) { status.setText("No shared profile yet · Use this device as source to begin."); return; }
        const differences = this.plugin.differences(profile);
        status.setText(`Profile from ${profile.sourceDevice} · ${differences.filter(i => i.kind === "match").length} matching · ${differences.filter(i => i.kind === "missing").length} missing · ${differences.filter(i => i.kind === "enable" || i.kind === "disable").length} different · ${differences.filter(i => i.kind === "skipped").length} skipped`);
        this.drawList(el, differences);
      } catch (error) { status.setText(`Profile needs attention: ${displayError(error)}`); }
    })();
    new Setting(el).setName("Set up this device").setDesc("Preview installations and enabled state changes before restoring.")
      .addButton(b => b.setButtonText("Restore this device").setCta().onClick(() => void this.plugin.restorePreview()));
    new Setting(el).setName("Share this setup").setDesc("Preview before writing this device's plugins to the vault profile.")
      .addButton(b => b.setButtonText("Use this device as source").onClick(() => void this.plugin.capturePreview()));
    new Setting(el).setName("Advanced options").setDesc("Device label and per-plugin scopes.")
      .addToggle(t => t.setValue(this.plugin.settings.showAdvanced).onChange(async v => {
        this.plugin.settings.showAdvanced = v;
        await this.plugin.saveSettings(); this.display();
      }));
    if (this.plugin.settings.showAdvanced) {
      new Setting(el).setName("Device label").setDesc("Shown on the profile when you use this device as source.")
        .addText(t => t.setPlaceholder("This device").setValue(this.plugin.settings.deviceName)
          .onChange(async value => { this.plugin.settings.deviceName = value.slice(0, 80); await this.plugin.saveSettings(); }));
      el.createEl("p", { text: `Profile location: ${this.app.vault.configDir}/obsyncdian-profile.json` });
      el.createEl("p", { text: "Settings sync is unavailable in this release. Third-party settings can contain secrets even under ordinary names; none are exported or overwritten." });
      void (async () => {
        try {
          const profile = await this.plugin.profile();
          if (!profile || !el.isConnected) return;
          el.createEl("h3", { text: "Plugin scopes" });
          for (const [id, entry] of Object.entries(profile.plugins)) {
            new Setting(el).setName(entry.name).setDesc(`Current: ${scopeNames[entry.scope]}`)
              .addDropdown(d => {
                for (const [value, label] of Object.entries(scopeNames)) d.addOption(value, label);
                d.setValue(entry.scope).onChange(scope =>
                  void this.plugin.capturePreview({ id, scope: scope as Scope }));
              });
          }
        } catch { /* Status above explains unreadable profiles. */ }
      })();
    }
  }
  private drawList(el: HTMLElement, differences: Difference[]): void {
    const groups: Array<[Difference["kind"], string]> = [
      ["missing", "Missing"], ["enable", "Needs enabling"], ["disable", "Needs disabling"],
      ["skipped", "Skipped on this device"], ["match", "Matching"]
    ];
    for (const [kind, title] of groups) {
      const items = differences.filter(item => item.kind === kind);
      if (!items.length) continue;
      const details = el.createEl("details", { cls: "obsyncdian-group" });
      if (kind !== "match") details.open = true;
      details.createEl("summary", { text: `${title} · ${items.length}` });
      for (const item of items) details.createEl("div", {
        text: `${item.entry.name}${item.reason ? ` — ${item.reason}` : ""}`,
        cls: "obsyncdian-item"
      });
    }
  }
}
