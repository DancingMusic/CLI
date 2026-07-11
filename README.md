# @dancingmusic/cli

The public developer CLI for independent DancingMusic plugins and music
connectors. It validates implementation manifests and submits registry records
to `DancingStore` or `MusicStore` without requiring GitHub CLI.

## Install

```bash
npm install --global @dancingmusic/cli
```

## Manifest

Each implementation owns a `dancingmusic.json` file:

```json
{
  "$schema": "https://dancingmusic.github.io/schemas/implementation-v1.json",
  "schemaVersion": 1,
  "kind": "plugin",
  "id": "example-plugin",
  "name": "Example Plugin",
  "summary": "An audio-reactive example visualization.",
  "version": "1.0.0",
  "publisher": { "name": "Example", "url": "https://github.com/example" },
  "repository": "https://github.com/example/DancePlugin-Example",
  "license": {
    "name": "MIT",
    "url": "https://github.com/example/DancePlugin-Example/blob/main/LICENSE",
    "commercialUse": true
  },
  "protocol": { "package": "@dancingmusic/plugin-sdk", "range": "^1.0.0" },
  "artifact": {
    "url": "https://github.com/example/DancePlugin-Example/releases/download/v1.0.0/plugin.tgz"
  },
  "capabilities": ["audio-reactive"],
  "permissions": [],
  "tags": ["example"]
}
```

## Commands

```bash
dancingmusic validate
dancingmusic manifest
dancingmusic doctor
dancingmusic auth login
dancingmusic submit --dry-run
```

`auth login` uses GitHub Device Flow directly. It never invokes `gh`. The
organization OAuth App public client id is supplied through
`DANCINGMUSIC_GITHUB_CLIENT_ID`; credentials are stored in the operating-system
credential store when the optional `keytar` package is available.

`dancingmusic submit --yes` forks the owning Store through GitHub REST, writes
one normalized registry record on a submission branch and opens a pull request.
It never puts a token in a Git remote URL and never uploads implementation
source into a Store.
