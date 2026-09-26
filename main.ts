import { App, Modal, Notice, Platform, Plugin, PluginSettingTab, Setting, type ButtonComponent } from "obsidian";
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
  get device(): Device { return Platform.isMobileApp ? "mobile" : "desktop"; }
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
        const list = el.createDiv({ cls: "obsyncdian-preview-list" });
        for (const [ids, label, entries] of [
          [added, "Add to profile", proposal.plugins],
          [updated, "Update in profile", proposal.plugins],
          [removed, "Remove from profile", beforeEntries]
        ] as const) {
          for (const id of ids) {
            const row = list.createDiv({ cls: "obsyncdian-preview-row" });
            row.createEl("strong", { text: entries[id].name });
            row.createSpan({ text: label });
          }
        }
        if (removed.length) el.createEl("p", { text: "Removing entries from the profile does not uninstall plugins on any device." });
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
        el.createEl("p", { text: `Profile from ${profile.sourceDevice} · ${this.device} · Updated ${new Date(profile.updatedAt).toLocaleString()}` });
        el.createEl("p", { text: `${actions.length} changes · ${reviewed.filter(i => i.kind === "match").length} matching · ${reviewed.filter(i => i.kind === "skipped").length} skipped` });
        const list = el.createEl("div", { cls: "obsyncdian-preview-list" });
        for (const [kind, label] of [
          ["missing", "Install"], ["enable", "Enable"], ["disable", "Disable"],
          ["skipped", "Skipped"], ["match", "Already matching"]
        ] as const) {
          const items = reviewed.filter(item => item.kind === kind);
          if (!items.length) continue;
          const group = list.createEl("details", { cls: "obsyncdian-group" });
          group.open = kind !== "match";
          group.createEl("summary", { text: `${label} · ${items.length}` });
          for (const item of items) {
            const row = group.createDiv({ cls: "obsyncdian-preview-row" });
            row.createEl("strong", { text: item.entry.name });
            row.createSpan({ text: item.kind === "missing"
              ? item.entry.enabled ? "Install and enable" : "Install, leave disabled"
              : item.kind === "skipped" ? item.reason ?? "Unavailable" : label });
          }
        }
        el.createEl("p", { text: "No plugins will be uninstalled. Existing plugin settings will not be changed. Obsidian may need a restart after installation." });
      }, actions.length ? "Apply changes" : "Done", async () => {
        if (!actions.length) return;
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
  private renderId = 0;
  constructor(app: App, private plugin: Obsyncdian) { super(app, plugin); }
  display(): void {
    const el = this.containerEl;
    const renderId = ++this.renderId;
    el.empty();
    el.addClass("obsyncdian-settings");
    el.createEl("h2", { text: "Obsyncdian" });
    el.createEl("p", { text: "Your plugin setup, carried by your vault." });
    const status = el.createDiv({ cls: "obsyncdian-status" });
    status.setAttribute("aria-live", "polite");
    const comparison = el.createDiv({ cls: "obsyncdian-comparison" });
    el.createEl("h3", { text: "Sync actions" });
    let restoreButton: ButtonComponent | undefined;
    new Setting(el).setName("Set up this device like your other devices")
      .setDesc("Review plugin installations and enabled state before applying changes.")
      .addButton(b => { restoreButton = b.setButtonText("Preview restore").setCta().setDisabled(true)
        .onClick(() => void this.plugin.restorePreview()); });
    let sourceButton: ButtonComponent | undefined;
    new Setting(el).setName("Use this device as source")
      .setDesc("Review changes to the shared profile before saving it to your vault.")
      .addButton(b => { sourceButton = b.setButtonText("Use this device as source")
        .onClick(() => void this.plugin.capturePreview()); });
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
    }
    const scopesArea = el.createDiv({ cls: "obsyncdian-scopes" });
    status.createEl("h3", { text: "Checking this device…" });
    const showError = (title: string, message: string, error: unknown): void => {
      if (renderId !== this.renderId || !el.isConnected) return;
      restoreButton?.setDisabled(true);
      sourceButton?.setDisabled(true);
      status.empty();
      status.addClass("obsyncdian-status-error");
      status.createEl("h3", { text: title });
      status.createEl("p", { text: message });
      const details = status.createEl("details");
      details.createEl("summary", { text: "Error details" });
      details.createEl("p", { text: displayError(error) });
    };
    void (async () => {
      let profile: Profile | null;
      try {
        profile = await this.plugin.profile();
      } catch (error) {
        showError("Profile needs attention", "The shared profile could not be read. Check it in your vault or restore a backup before continuing.", error);
        return;
      }
      try {
        if (renderId !== this.renderId || !el.isConnected) return;
        status.empty();
        status.createDiv({ text: `${this.plugin.device === "mobile" ? "Mobile" : "Desktop"} device · Shared profile`, cls: "obsyncdian-eyebrow" });
        if (!profile) {
          status.createEl("h3", { text: "Start with this device" });
          status.createEl("p", { text: "No shared profile yet. Use this device as source to share its plugin setup through your vault." });
          return;
        }
        const differences = this.plugin.differences(profile);
        restoreButton?.setDisabled(false);
        const count = (kind: Difference["kind"]) => differences.filter(item => item.kind === kind).length;
        const pending = count("missing") + count("enable") + count("disable");
        status.createEl("h3", { text: pending ? "Changes available for this device" : "No changes to apply on this device" });
        status.createEl("p", { text: `From ${profile.sourceDevice} · Updated ${new Date(profile.updatedAt).toLocaleString()}` });
        const counts = status.createDiv({ cls: "obsyncdian-counts" });
        for (const [label, value] of [
          ["Matching", count("match")], ["Missing", count("missing")],
          ["State changes", count("enable") + count("disable")], ["Skipped", count("skipped")]
        ] as const) {
          const badge = counts.createDiv({ cls: "obsyncdian-count" });
          badge.createEl("strong", { text: String(value) });
          badge.createEl("span", { text: label });
        }
        this.drawList(comparison, differences);
        if (this.plugin.settings.showAdvanced) this.drawScopes(scopesArea, profile);
      } catch (error) {
        showError("Couldn't check this device", "The shared profile is readable, but Obsyncdian could not check installed plugins on this device. No changes were made.", error);
      }
    })();
  }
  private drawScopes(el: HTMLElement, profile: Profile): void {
    el.createEl("h3", { text: "Plugin scopes" });
    el.createEl("p", { text: "Choose where each plugin belongs. Changes to the profile always have a preview." });
    for (const [id, entry] of Object.entries(profile.plugins)) {
      new Setting(el).setName(entry.name).setDesc(`Current: ${scopeNames[entry.scope]}`)
        .addDropdown(d => {
          for (const [value, label] of Object.entries(scopeNames)) d.addOption(value, label);
          d.setValue(entry.scope).onChange(scope =>
            void this.plugin.capturePreview({ id, scope: scope as Scope }));
        });
    }
  }
  private drawList(el: HTMLElement, differences: Difference[]): void {
    if (!differences.length) return;
    el.createEl("h3", { text: "Plugin comparison" });
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
      for (const item of items) {
        const row = details.createDiv({ cls: "obsyncdian-item" });
        row.createSpan({ text: item.entry.name });
        row.createSpan({ text: item.reason ?? (item.entry.enabled ? "Enabled in profile" : "Disabled in profile"), cls: "obsyncdian-item-detail" });
      }
    }
  }
}
