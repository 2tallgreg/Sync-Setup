# Obsyncdian product brief

## Promise
**Your Obsidian setup, on every device.**

Obsyncdian makes the environment around a vault portable: community plugins, enabled state, and eventually eligible plugin settings, themes, snippets, hotkeys, and selected preferences.

## Principles
- Vault-first: no separate account/server for MVP.
- Safe by default: preview drift; do not silently remove or overwrite.
- Device-aware: desktop and mobile can intentionally differ.
- Secrets stay local: never intentionally export SecretStorage or credentials.
- Transport-agnostic: Obsidian Sync, Syncthing, iCloud, Git, etc. can carry the profile.

## MVP
1. Capture installed community plugins and enabled state.
2. Store a versioned profile at `.obsidian/obsyncdian-profile.json`.
3. Compare local state with that profile.
4. Support scopes: everywhere, desktop, mobile, local.
5. Show missing plugins and enabled-state drift without making destructive changes.
6. Add restore/install behind an explicit confirmation flow.
7. Add settings sync only as an opt-in, backed-up operation with credential-key filtering.

## Important implementation note
Obsidian does not expose every community-plugin management operation through a stable public API. Private API access should stay isolated behind a small adapter so it can be replaced if official APIs arrive.

## Later
Named profiles, device overrides, themes/CSS/hotkeys, rollback/history, conflict resolution, export/import, and one-click “set up like my MacBook.”
