# OpenSpec: DancingMusic CLI

- Spec-ID: `dancingmusic-cli-openspec`
- Version: `1.0.0`
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

## Store routing

- `kind: plugin` routes to `DancingMusic/DancingStore`.
- `kind: connector` routes to `DancingMusic/MusicStore`.
- The CLI consumes Store schemas; it does not redefine Store ownership.

## MUST

- Work without `gh`.
- Keep `validate`, `doctor` and manifest generation usable without login.
- Redact credentials from errors and structured output.
- Make submission idempotent and show the proposed record before mutation.
- Require explicit `--yes` for non-interactive submission.

## MUST NOT

- Read music-provider credentials or host state.
- execute downloaded plugin/connector bundles during validation.
- push implementation source into a Store.
- put OAuth tokens in Git remote URLs, command arguments or plaintext files.
