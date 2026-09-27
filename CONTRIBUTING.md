# Contributing to Sync Setup

Thanks for helping improve Sync Setup.

## Development

Use Node.js 22 and install the locked development dependencies:

```sh
npm ci
```

Run the complete local check before opening a pull request:

```sh
npm run release:verify
```

This runs tests, linting, TypeScript validation, the production build, and release-package validation.

## Pull requests

Describe the user-facing effect, include any relevant safety considerations, and keep changes to the plugin profile format backward compatible. The plugin must not export third-party settings, credentials, tokens, passwords, or SecretStorage data.

## Releases

The release tag must exactly match `manifest.json` and use `x.y.z` semantic versioning. Pushing that tag runs the release workflow, which verifies the source and uploads `main.js`, `manifest.json`, and `styles.css` to the GitHub release.
