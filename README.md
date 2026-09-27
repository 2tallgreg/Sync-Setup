# VaultDeck

Carry your Obsidian community plugin setup between devices using the vault sync service you already use. VaultDeck stores a readable profile in your vault; it does not run a sync service or require an account.

## What it does

- Records installed community plugins, whether they are enabled, and whether each belongs everywhere, on desktop, on mobile, or only on this device.
- Compares a device with the shared profile and shows matching, missing, different, and skipped plugins.
- Offers a review screen before installing plugins or changing enabled state. It never uninstalls plugins.
- Skips desktop-only plugins on mobile and checks compatibility before offering an install.
- Keeps plugin settings and credentials out of the profile. Settings sync is not available in this release.

## Install

After VaultDeck is listed in Obsidian's Community Plugins directory:

1. In Obsidian, open **Settings → Community plugins → Browse**.
2. Search for **VaultDeck**, install it, and enable it.
3. Open **Settings → VaultDeck**.

Until then, install the files from a GitHub release into `<vault>/<config-folder>/plugins/obsyncdian/`. The release contains `main.js`, `manifest.json`, and `styles.css`. Restart Obsidian and enable VaultDeck under **Community plugins**.

## Set up devices

1. On the device with your preferred setup, open VaultDeck settings and choose **Use this device as source**. Review the proposed profile changes and save.
2. Let your existing vault sync finish. VaultDeck writes `vaultdeck-profile.json` at the vault root, so devices can share it even if they use different Obsidian configuration folders.
3. Install and enable VaultDeck on the other device. Open its settings and choose **Preview restore**. Review the proposed installs and enabled-state changes, then apply the ones you want.

With Obsidian Sync, make sure the vault syncs other file types and that `vaultdeck-profile.json` is not excluded. Obsidian Sync's community-plugin list settings can independently install or enable plugins; configure those settings on each device if you want VaultDeck to control this workflow. With another sync service, allow it to sync the profile file. Wait for sync to finish before capturing or restoring.

VaultDeck supports desktop and mobile in its manifest and uses Obsidian vault APIs for the profile. Mobile support has not yet been verified on physical iOS and Android devices. Restore uses Obsidian's internal plugin manager methods, which are not part of its public plugin API; if a required method is unavailable, VaultDeck reports the affected action rather than editing plugin files directly.

## Profile and safety

The profile is JSON you can inspect and version with your vault. Replacing an existing profile first saves `vaultdeck-profile.backup.json` alongside it. VaultDeck previews changes, rechecks the profile and local plugin inventory before applying, never removes installed plugins, and never reads or writes third-party plugin settings files. SecretStorage data, credentials, tokens, and passwords are not exported.

Plugin binaries are installed from Obsidian's official community plugin directory. The profile stores plugin IDs, names, enabled state, scope, and desktop-only metadata; it does not pin plugin versions or carry plugin binaries. Missing plugins that cannot be found, installed, or used on the current device are shown as skipped.

VaultDeck has no account, server, telemetry, or network activity except release lookup during an explicit restore, which checks Obsidian's community plugin directory and the plugin repositories listed there.

## Build from source

```sh
npm ci
npm run build
npm test
npm run lint
npm run typecheck
```

## License

MIT. See [LICENSE](LICENSE).

Obsidian is a trademark of Dynalist Inc. VaultDeck is an independent project and is not affiliated with or endorsed by Obsidian.
