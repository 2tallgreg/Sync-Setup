export type Scope = "everywhere" | "desktop" | "mobile" | "local";
export type Device = "desktop" | "mobile";

export interface ProfilePlugin {
  name: string;
  enabled: boolean;
  scope: Scope;
  desktopOnly: boolean;
}
export interface Profile {
  schemaVersion: 2;
  updatedAt: string;
  sourceDevice: string;
  plugins: Record<string, ProfilePlugin>;
}
export interface InstalledPlugin {
  id: string;
  name: string;
  enabled: boolean;
  desktopOnly: boolean;
}

const scopes: Scope[] = ["everywhere", "desktop", "mobile", "local"];
const validId = (id: string): boolean => /^[a-z0-9][a-z0-9_-]*$/.test(id) && id.length <= 100;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Reject malformed profiles rather than interpreting unknown data as actions. v1 is read-only migrated in memory. */
export function parseProfile(raw: string): Profile {
  const root: unknown = JSON.parse(raw);
  if (!record(root) || (root.schemaVersion !== 1 && root.schemaVersion !== 2) ||
      typeof root.updatedAt !== "string" || !Number.isFinite(Date.parse(root.updatedAt)) ||
      typeof root.sourceDevice !== "string" || !record(root.plugins)) {
    throw new Error("Unsupported or invalid profile");
  }
  const plugins: Record<string, ProfilePlugin> = Object.create(null) as Record<string, ProfilePlugin>;
  for (const [id, value] of Object.entries(root.plugins)) {
    if (!validId(id) || !record(value) || typeof value.enabled !== "boolean" ||
        !scopes.includes(value.scope as Scope)) throw new Error(`Invalid plugin entry: ${id}`);
    if (root.schemaVersion === 2 &&
        (typeof value.name !== "string" || typeof value.desktopOnly !== "boolean")) {
      throw new Error(`Invalid plugin metadata: ${id}`);
    }
    const name = root.schemaVersion === 2 ? value.name as string : id;
    plugins[id] = {
      name: name.trim().slice(0, 120) || id,
      enabled: value.enabled,
      scope: value.scope as Scope,
      desktopOnly: root.schemaVersion === 2 ? value.desktopOnly as boolean : false
    };
  }
  return { schemaVersion: 2, updatedAt: root.updatedAt, sourceDevice: root.sourceDevice, plugins };
}

export function applies(scope: Scope, device: Device): boolean {
  return scope === "everywhere" || scope === device;
}

/** Preserve other-platform entries and existing scope choices on capture. */
export function captureProfile(
  installed: InstalledPlugin[], prior: Profile | null, device: Device, source: string, now: string
): Profile {
  const plugins: Record<string, ProfilePlugin> = Object.create(null) as Record<string, ProfilePlugin>;
  for (const [id, entry] of Object.entries(prior?.plugins ?? {})) {
    if (!applies(entry.scope, device)) plugins[id] = { ...entry };
  }
  for (const plugin of installed) {
    if (!validId(plugin.id) || plugin.id === "obsyncdian") continue;
    const old = prior?.plugins[plugin.id];
    // An installed plugin can still be scoped to another device (or local-only).
    // Preserve its policy and enabled state, but refresh manifest-derived compatibility.
    if (old && !applies(old.scope, device)) {
      plugins[plugin.id] = { ...old, desktopOnly: plugin.desktopOnly };
      continue;
    }
    plugins[plugin.id] = {
      name: plugin.name, enabled: plugin.enabled,
      scope: old?.scope ?? (plugin.desktopOnly ? "desktop" : "everywhere"),
      desktopOnly: plugin.desktopOnly
    };
  }
  return { schemaVersion: 2, updatedAt: now, sourceDevice: source, plugins: sorted(plugins) };
}

export function sorted(plugins: Record<string, ProfilePlugin>): Record<string, ProfilePlugin> {
  return Object.fromEntries(Object.entries(plugins).sort(([a], [b]) => a.localeCompare(b)));
}

export function profileText(profile: Profile): string {
  return JSON.stringify({ ...profile, plugins: sorted(profile.plugins) }, null, 2) + "\n";
}
