# Obsidian Strava Periodic Sync

Sync your Strava activities to Obsidian daily notes with OAuth2 authentication.

## Features

- OAuth2 authentication with Strava
- Auto-sync at configurable intervals (5/10/30/60 min)
- Activities section with emoji, pace/speed, distance, duration, elevation
- Frontmatter metrics (running_distance_m, cycling_distance_m, walking_distance_m, etc.)
- Historical backfill support (up to 90 days)
- Detects daily notes from Periodic Notes or Daily Notes plugin
- Secure credential storage using Obsidian's SecretStorage API

## Installation

### Community plugin store (pending approval)

The plugin is under review for the community plugin store ([obsidianmd/obsidian-releases#9891](https://github.com/obsidianmd/obsidian-releases/pull/9891)). Once approved, install it via Settings → Community plugins → Browse.

### BRAT (recommended until store approval)

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat)
2. In BRAT settings, choose "Add beta plugin" and enter `jamesjarvis/obsidian-strava-periodic-sync`
3. Enable the plugin in Obsidian settings

BRAT automatically updates the plugin whenever a new release is published.

### Manual installation

1. Download **only** `main.js` and `manifest.json` from the [latest release](https://github.com/jamesjarvis/obsidian-strava-periodic-sync/releases/latest)
2. Create the folder `<vault>/.obsidian/plugins/strava-periodic-note-sync/`
3. Copy the two files into that folder
4. Enable the plugin in Obsidian settings

> **Warning:** Do not clone the repository into your vault. The repo contains `node_modules/` and `src/`, which bloat the vault and break iCloud sync. Only `main.js` and `manifest.json` belong in the plugin folder.

Your settings are stored in `data.json` inside the plugin folder — keep that file when updating manually.

## Setup

1. Create a Strava API application at https://www.strava.com/settings/api
2. Set "Authorization Callback Domain" to `localhost`
3. Enter your Client ID and Client Secret in the plugin settings
4. Click "Open Strava Auth" to open the authorization page
5. Authorize the application on Strava
6. Copy the `code` parameter from the redirected URL (the localhost URL will fail to load - that's expected)
7. Paste the code and click "Connect"

## Daily Note Format

The plugin adds an Activities section to your daily notes:

```markdown
#### Activities
- 🏃 **Morning Run** - 5.2 km in 28:15 (5:26 /km) | +45m elevation
- 🚴 **Evening Ride** - 22.4 km in 52:30 (25.6 km/h) | +180m elevation
```

## Frontmatter Metrics

The plugin updates these frontmatter fields:

| Field | Description |
|-------|-------------|
| `walking_distance_m` | Walk/Hike activities (metres) |
| `running_distance_m` | Run activities (metres) |
| `cycling_distance_m` | Ride activities (metres) |
| `swimming_distance_m` | Swim activities (metres) |
| `active_time` | Total moving time (minutes) |

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Daily Notes Folder | Path to daily notes folder | Auto-detect |
| Section Header | Markdown header for activities | `#### Activities` |
| Omit Empty Section | Hide section when no activities | false |
| Auto-Sync Enabled | Enable background syncing | true |
| Sync Frequency | How often to auto-sync | 30 minutes |
| Historical Sync Days | Backfill previous days | 0 |

## Development

### Building from Source

```bash
npm install
npm run build
```

### Running Tests

```bash
npm run test        # Run tests once
npm run test:watch  # Run tests in watch mode
```

### Running Lints

```bash
npm run lint
```

### Installing a dev build

Keep the repository outside your vault. To test a build in Obsidian:

```bash
npm run build
OBSIDIAN_VAULT=/path/to/vault npm run install-to-vault
```

This copies only `main.js` and `manifest.json` into the plugin folder, then reload Obsidian to pick up the change. For faster iteration with `npm run dev`, the community [Hot Reload](https://github.com/pjeby/hot-reload) plugin reloads the plugin automatically on rebuild.

### Releasing

```bash
npm version patch --no-git-tag-version
```

This syncs the version across `package.json`, `manifest.json`, and `versions.json` via `version-bump.mjs`. Then:

1. Commit the version bump
2. Tag with the bare version: `git tag X.Y.Z` (no `v` prefix — Obsidian requires the tag to match the manifest version)
3. Push the tag: `git push origin X.Y.Z`

CI drafts a GitHub release with `main.js` and `manifest.json` attached. Publish the draft to make it available.

## License

MIT License - see [LICENSE](LICENSE) for details.
