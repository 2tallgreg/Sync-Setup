import assert from "node:assert/strict";
import test from "node:test";
import { captureProfile, parseProfile, profileText, type Profile } from "../profile";
import { assertPreviewUnchanged, reconcile, reviewRestore } from "../reconcile";

const fixture = (): Profile => parseProfile(JSON.stringify({
  schemaVersion: 2, updatedAt: "2026-09-26T00:00:00Z", sourceDevice: "Mac",
  plugins: {
    calendar: { name: "Calendar", enabled: true, scope: "everywhere", desktopOnly: false },
    git: { name: "Obsidian Git", enabled: true, scope: "desktop", desktopOnly: true },
    tasks: { name: "Tasks", enabled: false, scope: "everywhere", desktopOnly: false },
    private: { name: "Private", enabled: true, scope: "local", desktopOnly: false },
    phone: { name: "Phone", enabled: true, scope: "mobile", desktopOnly: false }
  }
}));

test("v1 profile migrates to v2 with safe metadata defaults", () => {
  const old = JSON.stringify({
    schemaVersion: 1, updatedAt: "2026-09-26T00:00:00Z", sourceDevice: "Old Mac",
    plugins: { calendar: { enabled: true, scope: "everywhere", syncSettings: true } }
  });
  const current = parseProfile(old);
  assert.equal(current.schemaVersion, 2);
  assert.deepEqual(current.plugins.calendar, {
    name: "calendar", enabled: true, scope: "everywhere", desktopOnly: false
  });
  assert.equal(profileText(current).includes("syncSettings"), false);
});

test("malformed versions, IDs, flags, and scopes are rejected before actions", () => {
  for (const invalid of [
    '{"schemaVersion":3,"updatedAt":"2026-09-26","sourceDevice":"x","plugins":{}}',
    '{"schemaVersion":2,"updatedAt":"2026-09-26","sourceDevice":"x","plugins":{"../bad":{"name":"x","enabled":true,"scope":"everywhere","desktopOnly":false}}}',
    '{"schemaVersion":2,"updatedAt":"2026-09-26","sourceDevice":"x","plugins":{"okay":{"name":"x","enabled":"yes","scope":"everywhere","desktopOnly":false}}}',
    '{"schemaVersion":2,"updatedAt":"2026-09-26","sourceDevice":"x","plugins":{"okay":{"name":"x","enabled":true,"scope":"unknown","desktopOnly":false}}}'
  ]) assert.throws(() => parseProfile(invalid));
});

test("desktop and mobile classify matching, missing, state differences, and skipped scopes", () => {
  const installed = [
    { id: "calendar", name: "Calendar", enabled: true, desktopOnly: false },
    { id: "tasks", name: "Tasks", enabled: true, desktopOnly: false }
  ];
  const desktop = Object.fromEntries(reconcile(fixture(), installed, "desktop").map(i => [i.id, i.kind]));
  assert.deepEqual(desktop, {
    calendar: "match", git: "missing", tasks: "disable", private: "skipped", phone: "skipped"
  });
  const mobile = Object.fromEntries(reconcile(fixture(), installed, "mobile").map(i => [i.id, i.kind]));
  assert.deepEqual(mobile, {
    calendar: "match", git: "skipped", tasks: "disable", private: "skipped", phone: "missing"
  });
});

test("desktop-only metadata always skips mobile, even if scope says everywhere", () => {
  const profile = fixture();
  profile.plugins.git.scope = "everywhere";
  assert.equal(reconcile(profile, [], "mobile").find(i => i.id === "git")?.reason, "Desktop-only plugin");
});

test("capture preserves remote platform and local-only scopes; excludes this plugin", () => {
  const captured = captureProfile([
    { id: "calendar", name: "Calendar", enabled: false, desktopOnly: false },
    { id: "private", name: "Private", enabled: true, desktopOnly: false },
    { id: "obsyncdian", name: "Sync Setup", enabled: true, desktopOnly: false }
  ], fixture(), "desktop", "Windows", "2026-09-27T00:00:00Z");
  assert.equal(captured.plugins.calendar.enabled, false);
  assert.equal(captured.plugins.phone.scope, "mobile");
  assert.equal(captured.plugins.private.scope, "local");
  assert.equal(captured.plugins.tasks, undefined);
  assert.equal(captured.plugins.obsyncdian, undefined);
});

test("capture preserves installed entries scoped to the other device or local", () => {
  const prior = fixture();
  const installed = [
    { id: "phone", name: "Phone", enabled: false, desktopOnly: false },
    { id: "git", name: "Obsidian Git", enabled: false, desktopOnly: true },
    { id: "private", name: "Private", enabled: false, desktopOnly: false }
  ];
  const desktop = captureProfile(installed, prior, "desktop", "Windows", "2026-09-27T00:00:00Z");
  assert.deepEqual(desktop.plugins.phone, prior.plugins.phone);
  assert.deepEqual(desktop.plugins.private, prior.plugins.private);
  assert.equal(desktop.plugins.git.enabled, false);

  const mobile = captureProfile(installed, prior, "mobile", "Phone", "2026-09-27T00:00:00Z");
  assert.deepEqual(mobile.plugins.git, prior.plugins.git);
  assert.deepEqual(mobile.plugins.private, prior.plugins.private);
  assert.equal(mobile.plugins.phone.enabled, false);
});

test("capture clears stale desktop-only metadata from a current manifest", () => {
  const prior = parseProfile(JSON.stringify({
    schemaVersion: 2, updatedAt: "2026-09-26T00:00:00Z", sourceDevice: "Mac",
    plugins: { plugin: { name: "Plugin", enabled: true, scope: "everywhere", desktopOnly: true } }
  }));
  const captured = captureProfile([
    { id: "plugin", name: "Plugin", enabled: true, desktopOnly: false }
  ], prior, "mobile", "Phone", "2026-09-27T00:00:00Z");
  assert.equal(captured.plugins.plugin.desktopOnly, false);
  prior.plugins.plugin.scope = "desktop";
  const otherDevice = captureProfile([
    { id: "plugin", name: "Plugin", enabled: false, desktopOnly: false }
  ], prior, "mobile", "Phone", "2026-09-27T00:00:00Z");
  assert.equal(otherDevice.plugins.plugin.desktopOnly, false);
  assert.equal(otherDevice.plugins.plugin.enabled, true);
  assert.equal(otherDevice.plugins.plugin.scope, "desktop");
});

test("capture defaults desktop-only plugins to desktop and round-trips readable JSON", () => {
  const captured = captureProfile([
    { id: "git", name: "Obsidian Git", enabled: true, desktopOnly: true }
  ], null, "desktop", "Mac", "2026-09-26T00:00:00Z");
  assert.equal(captured.plugins.git.scope, "desktop");
  assert.equal(profileText(parseProfile(profileText(captured))), profileText(captured));
});

test("restore approves only eligible profile actions and never targets extra local plugins", () => {
  const installed = [
    { id: "calendar", name: "Calendar", enabled: false, desktopOnly: false },
    { id: "extra", name: "Unrelated local plugin", enabled: true, desktopOnly: false }
  ];
  const reviewed = reviewRestore(reconcile(fixture(), installed, "desktop"), new Set(["git"]), true);
  assert.deepEqual(reviewed.filter(i => i.kind === "missing" || i.kind === "enable" || i.kind === "disable")
    .map(i => [i.id, i.kind]), [["calendar", "enable"], ["git", "missing"]]);
  assert.equal(reviewed.some(i => i.id === "extra"), false);
  assert.equal(reviewRestore(reconcile(fixture(), installed, "desktop"), new Set(), false)
    .every(i => i.kind === "skipped"), true);
});

test("restore refuses a stale preview if profile or inventory changed", () => {
  const inventory = [{ id: "calendar", name: "Calendar", enabled: true, desktopOnly: false }];
  assert.doesNotThrow(() => assertPreviewUnchanged("profile", "profile", inventory, [...inventory]));
  assert.throws(() => assertPreviewUnchanged("profile", "new profile", inventory, inventory));
  assert.throws(() => assertPreviewUnchanged("profile", "profile", inventory, []));
  assert.doesNotThrow(() => assertPreviewUnchanged(null, null, inventory, inventory));
  assert.throws(() => assertPreviewUnchanged(null, "new profile", inventory, inventory));
  assert.throws(() => assertPreviewUnchanged(null, null, inventory, []));
});

test("hand-edited profiles cannot install or disable Sync Setup", () => {
  for (const scope of ["everywhere", "desktop", "mobile", "local"] as const) {
    const profile = fixture();
    profile.plugins.obsyncdian = { name: "Sync Setup", enabled: false, scope, desktopOnly: false };
    for (const device of ["desktop", "mobile"] as const) {
      const changes = reviewRestore(reconcile(profile, [], device), new Set(["obsyncdian"]), true);
      assert.equal(changes.find(item => item.id === "obsyncdian")?.kind, "skipped");
      assert.equal(captureProfile([], profile, device, "Test", profile.updatedAt).plugins.obsyncdian, undefined);
    }
  }
});
