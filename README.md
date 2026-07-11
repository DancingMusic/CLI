# @dancingmusic/cli

The public developer CLI for independent DancingMusic plugins and music
connectors. It validates implementation manifests and submits registry records
to `DancingStore` or `MusicStore` without requiring GitHub CLI.

## Install

```bash
npm install --global github:DancingMusic/CLI#<verified-commit>
```

## Manifest

Each implementation owns a `dancingmusic.json` file:

```json
{
  "$schema": "https://raw.githubusercontent.com/DancingMusic/CLI/main/schemas/implementation-v1.schema.json",
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
dancingmusic dev --watch --build
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

## Local Dev Bridge

Run the bridge from a plugin or connector repository containing a valid
`dancingmusic.json`:

```bash
# Serve dist/index.js on 127.0.0.1:17373
dancingmusic dev

# Build first, then rebuild and notify the host when project files change
dancingmusic dev --watch --build

# Select another in-project artifact or an available loopback port
dancingmusic dev --artifact dist/plugin.js --port 0
```

The bridge exposes `GET /artifact`, `GET /manifest`, `GET /health` and the
`ws://127.0.0.1:17373/events` WebSocket endpoint. It validates the manifest
before listening, disables HTTP caches, serves only the selected artifact and
rejects traversal or symlinks outside the project. It never imports or executes
the implementation bundle.

Set `VITE_DANCINGMUSIC_DEV_BRIDGE=1` when starting a compatible DancingMusic
host. The host receives a versioned `implementation:update` event on connection
and after each successful watched change/rebuild. The bridge is intentionally
loopback-only and has no option to expose it to the LAN.

### Test with an installed desktop Release

A compatible installed DancingMusic desktop Release can use the same bridge in
its explicit local test/developer mode. Start `dancingmusic dev`, then launch
the desktop Release with:

```bash
# macOS
open -a DancingMusic --args --enable-local-dev-bridge

# Windows / Linux executable
DancingMusic --enable-local-dev-bridge
```

Use `--local-dev-bridge-url=ws://127.0.0.1:PORT` when the CLI uses another
port. The desktop host reloads the implementation from the loopback
`bundleUrl`. The hosted Web Release does not support local implementation
injection.

This mode always requires a user opt-in. It does not make the Release listen on
the network, does not expose the bridge beyond loopback and does not weaken
normal Store installation or permission review.
