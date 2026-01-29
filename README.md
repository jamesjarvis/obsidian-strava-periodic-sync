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

### Manual Installation

1. Download the latest release (`main.js`, `manifest.json`)
2. Create folder: `.obsidian/plugins/strava-daily-note-sync/`
3. Copy files into the folder
4. Enable the plugin in Obsidian settings

### BRAT (Beta Reviewers Auto-update Tester)

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat)
2. Add this repository: `jamesjarvis/obsidian-strava-periodic-sync`
3. Enable the plugin

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

## Building from Source

```bash
npm install
npm run build
```

## License

MIT License - see [LICENSE](LICENSE) for details.
