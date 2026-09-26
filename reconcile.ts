import { applies, type Device, type InstalledPlugin, type Profile, type ProfilePlugin } from "./profile";

export type Kind = "match" | "missing" | "enable" | "disable" | "skipped";
export interface Difference {
  id: string;
  entry: ProfilePlugin;
  kind: Kind;
  reason?: string;
}

export function reconcile(profile: Profile, installed: InstalledPlugin[], device: Device): Difference[] {
  const local = new Map(installed.map(plugin => [plugin.id, plugin]));
  return Object.entries(profile.plugins).map(([id, entry]): Difference => {
    if (!applies(entry.scope, device)) return { id, entry, kind: "skipped", reason: `Scope: ${entry.scope}` };
    if (device === "mobile" && entry.desktopOnly) return { id, entry, kind: "skipped", reason: "Desktop-only plugin" };
    const found = local.get(id);
    if (found && device === "mobile" && found.desktopOnly) {
      return { id, entry, kind: "skipped", reason: "Installed plugin is desktop-only" };
    }
    if (!found) return { id, entry, kind: "missing" };
    return { id, entry, kind: found.enabled === entry.enabled ? "match" : entry.enabled ? "enable" : "disable" };
  });
}

export function isAction(kind: Kind): boolean {
  return kind === "missing" || kind === "enable" || kind === "disable";
}

/** Only these three operations can be approved. No extra local plugin is ever removed. */
export function reviewRestore(
  differences: Difference[], installable: ReadonlySet<string>, canChangeState: boolean,
  unavailableReason = "Unavailable in the community directory, incompatible, or installation unsupported"
): Difference[] {
  return differences.map(item => {
    if (item.kind === "missing" && !installable.has(item.id)) {
      return { ...item, kind: "skipped", reason: unavailableReason };
    }
    if ((item.kind === "enable" || item.kind === "disable" || item.kind === "missing") && !canChangeState) {
      return { ...item, kind: "skipped", reason: "Changing enabled state is unavailable" };
    }
    return item;
  });
}

export function assertPreviewUnchanged(
  profileBefore: string, profileNow: string | null, inventoryBefore: InstalledPlugin[], inventoryNow: InstalledPlugin[]
): void {
  if (profileBefore !== profileNow || JSON.stringify(inventoryBefore) !== JSON.stringify(inventoryNow)) {
    throw new Error("The profile or installed plugins changed since preview. Review again.");
  }
}
