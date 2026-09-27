# Sync Setup product brief

## Promise
**Your Obsidian setup, on every device.**

Sync Setup makes the environment around a vault portable: community plugins, enabled state, and eventually eligible plugin settings, themes, snippets, hotkeys, and selected preferences.

## Principles
- Vault-first: no separate account/server for MVP.
- Safe by default: preview drift; do not silently remove or overwrite.
- Device-aware: desktop and mobile can intentionally differ.
- Secrets stay local: never intentionally export SecretStorage or credentials.
- Transport-agnostic: Obsidian Sync, Syncthing, iCloud, Git, etc. can carry the profile.

## MVP
1. Capture installed community plugins and enabled state.
2. Store a versioned profile at `sync-setup-profile.json` in the vault root so devices with different config folders can share it.
3. Compare local state with that profile.
4. Support scopes: everywhere, desktop, mobile, local.
5. Show missing plugins and enabled-state drift without making destructive changes.
6. Add restore/install behind an explicit confirmation flow.
7. Investigate settings sync. Defer it until users can opt into individual plugins and keys, review values, and back up the replaced values safely. Filtering key names alone cannot guarantee secrets stay private.

## Important implementation note
Obsidian does not expose every community-plugin management operation through a stable public API. Private API access should stay isolated behind a small adapter so it can be replaced if official APIs arrive.

## Later
Named profiles, device overrides, themes/CSS/hotkeys, rollback/history, conflict resolution, export/import, and one-click “set up like my MacBook.”
