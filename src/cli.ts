import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildStoreRecord, validateManifest } from "./manifest.js";
import { deleteToken, readToken, saveToken } from "./credentials.js";
import { pollDeviceFlow, startDeviceFlow, storeRepository, submitStoreRecord } from "./github.js";

const program = new Command()
  .name("dancingmusic")
  .description("DancingMusic implementation developer CLI")
  .version("0.1.0");

program.command("validate")
  .option("--json", "emit machine-readable output")
  .action(async ({ json }) => {
    const result = await validateManifest();
    if (json) console.log(JSON.stringify(result, null, 2));
    else if (result.valid) console.log(`Valid ${result.manifest?.kind} manifest: ${result.manifest?.id}`);
    else result.errors.forEach((error) => console.error(`- ${error}`));
    if (!result.valid) process.exitCode = 1;
  });

program.command("manifest")
  .description("generate a normalized Store record")
  .option("--write", "write the record to a local preview file")
  .action(async ({ write }) => {
    const result = await validateManifest();
    if (!result.valid || !result.manifest) throw new Error(result.errors.join("\n"));
    const record = JSON.stringify(buildStoreRecord(result.manifest), null, 2) + "\n";
    if (write) {
      const path = resolve(`.${result.manifest.kind}-store-record.json`);
      await writeFile(path, record, { flag: "wx" });
      console.log(`Wrote ${path}`);
    } else console.log(record);
  });

const auth = program.command("auth");
auth.command("login").action(async () => {
  const request = await startDeviceFlow();
  console.log(`Open ${request.verification_uri} and enter ${request.user_code}`);
  const token = await pollDeviceFlow(request);
  if (!(await saveToken(token))) {
    throw new Error("No OS credential store is available; token was not persisted. Install optional dependency keytar or use DANCINGMUSIC_GITHUB_TOKEN for this process.");
  }
  console.log("GitHub authentication complete");
});
auth.command("status").action(async () => console.log((await readToken()) ? "Authenticated" : "Not authenticated"));
auth.command("logout").action(async () => { await deleteToken(); console.log("Logged out"); });

program.command("doctor").action(async () => {
  const result = await validateManifest();
  console.log(`Node: ${process.version}`);
  console.log(`Manifest: ${result.valid ? "valid" : "invalid"}`);
  console.log(`GitHub auth: ${(await readToken()) ? "available" : "missing"}`);
  if (result.manifest) console.log(`Store: DancingMusic/${storeRepository(result.manifest)}`);
  if (!result.valid) process.exitCode = 1;
});

program.command("submit")
  .description("validate and prepare a Store pull request")
  .option("--dry-run", "print the record without changing GitHub")
  .option("--yes", "confirm a non-interactive submission")
  .action(async ({ dryRun, yes }) => {
    const result = await validateManifest();
    if (!result.valid || !result.manifest) throw new Error(result.errors.join("\n"));
    const preview = buildStoreRecord(result.manifest);
    console.log(JSON.stringify(preview, null, 2));
    if (dryRun) return;
    if (!yes) throw new Error("Review the record and rerun with --yes");
    const token = await readToken();
    if (!token) throw new Error("Run dancingmusic auth login first");
    const url = await submitStoreRecord(result.manifest, preview, token);
    console.log(`Pull request: ${url}`);
  });

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.replace(/(gh[opsu]_[A-Za-z0-9_]+)/g, "[REDACTED]"));
  process.exitCode = 2;
});
