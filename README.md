# Obsyncdian

Carry your Obsidian community plugin setup between devices using the vault sync method you already use. No Obsyncdian account or server is required.

## Try the MVP

1. In a test vault, run `npm ci && npm run build`.
2. Copy `main.js`, `manifest.json`, and `styles.css` into your vault's `<config folder>/plugins/obsyncdian/` folder. Restart Obsidian and enable Obsyncdian in Community plugins.
3. Open **Settings → Obsyncdian → Use this device as source**. Review the changes, then write the profile.
4. Sync the vault using your existing service. Install Obsyncdian on the next device, open its Obsyncdian settings, and choose **Preview restore**. Review each action before applying it.

Obsyncdian writes a readable, versioned `obsyncdian-profile.json` in the vault's configuration folder (normally `.obsidian/`). It captures community plugin IDs, names, enabled state, scope, and known desktop-only metadata. A plugin defaults to **Desktop** when its installed manifest marks it desktop-only, otherwise **Everywhere**. Advanced options allow **Everywhere**, **Desktop**, **Mobile**, and **Local only** for each entry. Scope edits also use the source preview before writing.

The settings page shows matches, missing plugins, enabled state differences, and skipped entries. Restore checks install options with visible progress, then installs eligible missing plugins from Obsidian's official community directory and applies enabled state differences after an explicit preview. If a plugin's latest release needs a newer Obsidian version, restore checks its `versions.json` for an older compatible release. A plugin absent from the directory, unavailable during network lookup, incompatible with the current Obsidian version, or desktop-only on mobile is skipped. The profile does not carry plugin binaries or pin versions. Restricted mode and network availability may block installs; failures are reported.

## Safety and current limits

- No automatic actions on startup, no silent uninstall, and no deletion of local plugin files.
- Before replacing a shared profile, the previous one is saved as `obsyncdian-profile.backup.json` in the same configuration folder.
- Source captures and restores reject a preview if the profile or relevant local inventory changed. Only one apply operation can run at a time in an Obsyncdian instance. This is not a lock across devices: allow vault sync to finish and use one source at a time.
- Obsyncdian never installs or changes its own enabled state, even if a manually edited profile includes it. State changes are checked after Obsidian returns; a failed or ineffective operation is reported as a failure.
- Confirmation previews show scope and enabled state for profile changes. Once applying starts, the modal stays open until the operation finishes; closing the preview cannot cancel an installation already in progress.
- Restore never reads or writes third-party `data.json` files. No plugin settings, credentials, tokens, or SecretStorage contents are captured. Some vault sync tools already synchronize Obsidian's own plugin files; configure their exclusions separately if needed.
- Arbitrary plugin settings cannot be classified reliably as safe by inspecting key names. A future settings feature needs **per-plugin and per-key opt-in**, visible value review, and a backup of values to be replaced before applying changes. It must never export known secrets or SecretStorage data. Automated filtering alone cannot guarantee this.
- Obsidian does not provide public community plugin inventory/install/enable APIs. The undocumented calls are isolated in `obsidian-adapter.ts`. If they are unavailable, Obsyncdian reports a safe skip instead of attempting file surgery.
- The profile is stored in the active vault config folder via `vault.configDir`, which may differ from `.obsidian`. Mobile support is designed against Obsidian's API but has not yet been verified on a physical iOS/Android device.
- With Obsidian Sync, enable the relevant vault configuration sync settings on each device. Its separate **Active community plugin list** and **Installed community plugin list** options can also change plugins independently of Obsyncdian, so leave those off when you want Obsyncdian to control the restore workflow. Devices using different override config folders will not see the same Obsyncdian profile automatically; use the same config folder across participating devices for this MVP.
- The profile has one shared source. Updating it is manual. Capture retains entries scoped to other platforms and existing scope selections; it may remove entries that apply to the source device but are no longer installed. The preview lists those removals; no plugin is uninstalled from any device.
- Verify that the profile file reaches the other device before restoring. The status card compares the local copy of the profile; it does not monitor or guarantee completion of your sync service. See [Obsidian's selective sync documentation](https://obsidian.md/help/sync/settings) when configuring Obsidian Sync.

## Develop

```sh
npm ci
npm test
npm run lint
npm run typecheck
npm run build
npm run package
```

The pure `profile.ts` module validates schema 2 and migrates the initial schema 1 profile in memory. Saving writes schema 2. `reconcile.ts` computes a device-aware preview. `obsidian-adapter.ts` contains all private Obsidian plugin-manager access and directory lookup. `main.ts` handles vault I/O and the explicit preview/apply workflows, rechecking the profile and local inventory immediately before restoring. See `PRODUCT.md` for product direction.

## Release package

`npm run package` builds the plugin and stages exactly the three files Obsidian installs from a GitHub release: `main.js`, `manifest.json`, and `styles.css`. The release workflow runs the full verification set when an exact version tag is pushed, verifies that it matches the manifest, and uploads those assets to the GitHub release. Use `npm version patch`, `npm version minor`, or `npm version major` to keep `package.json`, `manifest.json`, and `versions.json` aligned before committing and tagging.

For Community Directory publication, Obsidian requires a license and applies naming rules to the display name as well as the ID. The current display name, `Obsyncdian`, is likely to be considered a variation of “Obsidian”; choose a compliant public name before submitting it to the directory.
