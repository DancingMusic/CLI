# OpenSpec: DancingMusic CLI

- Spec-ID: `dancingmusic-cli-openspec`
- Version: `1.2.0`
- Status: `Active`
- Last-Updated: `2026-07-12`

## Scope

`@dancingmusic/cli` is the public developer entry for creating, validating and
submitting independent DancePlugin and MusicConnect implementations. It does
not require GitHub CLI and does not contain host, plugin or connector runtime
implementation code.

## Submission contract

1. Read and validate `dancingmusic.json` locally.
2. Require an immutable semantic-version tag and HTTPS artifact URL.
3. Produce a normalized Store record with a SHA-256 digest.
4. Authenticate with GitHub Device Flow using the public OAuth client id.
5. Use GitHub REST APIs to fork the correct Store, create a submission branch,
   write one registry record and open a pull request.
6. Store credentials in the operating-system credential store when available;
   never log or write a token to project files.

An implementation may declare international/domestic artifact mirrors,
`releaseNotesUrl` and `publishedAt`. The primary immutable `artifact.url`
remains required for v1 compatibility. Mirrors MUST identify their region and
must represent the exact same bytes covered by the shared integrity value.

## Store routing

- `kind: plugin` routes to `DancingMusic/DancingStore`.
- `kind: connector` routes to `DancingMusic/MusicStore`.
- The CLI consumes Store schemas; it does not redefine Store ownership.

## Local development bridge

`dancingmusic dev` exposes the current implementation artifact to a local
DancingMusic host without publishing a release or Store record.

1. The command MUST validate `dancingmusic.json` before opening a socket and
   MUST support both `plugin` and `connector` manifests.
2. It MUST bind only to `127.0.0.1`. Binding to wildcard, LAN or public
   interfaces is outside this command's scope and cannot be enabled by flags.
3. `GET /artifact` serves exactly one configured local artifact. The response
   disables caching and enables local CORS. Other filesystem paths are never
   mapped to HTTP routes.
4. `GET /manifest` returns the validated manifest. `GET /health` reports bridge
   identity, kind, artifact revision, connected-host count, current sequence,
   artifact request count and the last broadcast/artifact-request timestamps.
   All JSON responses disable caching.
5. WebSocket clients connect at `/events`. On connection and after every
   successful rebuild/change the bridge sends
   `{ protocolVersion: 1, type: "implementation:update", kind, id, version,
   bundleUrl, sequence }`. `sequence` is monotonic for the bridge process and
   `bundleUrl` is always a loopback HTTP URL. The host opts in through
   `VITE_DANCINGMUSIC_DEV_BRIDGE=1`. Compatible installed desktop Releases may
   expose the same explicit local test mode; it is disabled unless the user
   opts in and it still connects only to loopback.
6. `--watch` watches the project while excluding `.git`, `node_modules` and the
   served artifact. Changes either emit `reload` directly or, with `--build`,
   run the local package `build` script before emitting the next update.
   Builds are serialized and coalesced.
7. `--build` executes only the current project's declared `scripts.build`
   through the detected local package manager. It never downloads or executes
   a remote artifact. An initial build is optional through `--build`.
8. Artifact resolution MUST stay within the project root, reject symlinks that
   escape it, reject directories and path traversal, and recheck the resolved
   path before every response.

The Dev Bridge is a local development transport. It does not load the artifact,
access provider credentials, mutate host playback, submit to a Store or grant a
plugin/connector additional permissions.

Every Dev Bridge update is test-only. The host MUST present injected plugins
and connectors with a visible testing marker, keep them session-only and never
write them into the formal installed-record or Store submission state.

The WebSocket endpoint is `/events`. CLI terminal output MUST report host
connect/disconnect, artifact requests and broadcasts without printing provider
credentials, connector config, query text or artifact contents. These signals
prove transport activity; a host-side load success/failure message remains the
authority for whether the implementation initialized successfully.

## MUST

- Work without `gh`.
- Keep `validate`, `doctor` and manifest generation usable without login.
- Keep the Dev Bridge local-only, cache-free and independent of GitHub login.
- Redact credentials from errors and structured output.
- Make submission idempotent and show the proposed record before mutation.
- Require explicit `--yes` for non-interactive submission.

## MUST NOT

- Read music-provider credentials or host state.
- execute downloaded plugin/connector bundles during validation.
- push implementation source into a Store.
- put OAuth tokens in Git remote URLs, command arguments or plaintext files.
- serve arbitrary project files or execute a served plugin/connector artifact.
