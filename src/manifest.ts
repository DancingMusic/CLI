import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";
import type { ImplementationManifest, ValidationResult } from "./types.js";

const schemaUrl = new URL("../schemas/implementation-v1.schema.json", import.meta.url);

export async function loadManifest(cwd = process.cwd()): Promise<unknown> {
  return JSON.parse(await readFile(resolve(cwd, "dancingmusic.json"), "utf8"));
}

export async function validateManifest(cwd = process.cwd()): Promise<ValidationResult> {
  try {
    const [manifest, schema] = await Promise.all([
      loadManifest(cwd),
      readFile(schemaUrl, "utf8").then(JSON.parse),
    ]);
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    if (!validate(manifest)) {
      return {
        valid: false,
        errors: (validate.errors ?? []).map((error: ErrorObject) => `${error.instancePath || "/"} ${error.message}`),
      };
    }
    const typed = manifest as ImplementationManifest;
    const expectedPackage = typed.kind === "plugin" ? "@dancingmusic/plugin-sdk" : "@dancingmusic/music-connect";
    const errors = typed.protocol.package === expectedPackage
      ? []
      : [`protocol.package must be ${expectedPackage} for ${typed.kind} projects`];
    if (/(?:@|\/)(?:main|master|latest)(?:\/|$)/i.test(typed.artifact.url)) {
      errors.push("artifact.url must reference an immutable version, not main/master/latest");
    }
    for (const mirror of typed.artifact.mirrors ?? []) {
      if (/(?:@|\/)(?:main|master|latest)(?:\/|$)/i.test(mirror.url)) {
        errors.push(`artifact mirror (${mirror.region}) must reference an immutable version`);
      }
    }
    if ((typed.artifact.mirrors?.length ?? 0) > 0 && !typed.artifact.integrity) {
      errors.push("artifact.integrity is required when mirrors are declared");
    }
    if (typed.kind === "connector") {
      const connector = typed.connector;
      const capabilities = typed.capabilities ?? [];
      const hasLogin = capabilities.includes("login");
      const accountPermission = !Array.isArray(typed.permissions) && typed.permissions?.account === true;
      if (!connector) errors.push("connector metadata is required for connector projects");
      else {
        if (connector.variant === "anonymous" && (connector.authRequirement !== "none" || hasLogin)) {
          errors.push("anonymous connector variants require authRequirement none and no login capability");
        }
        if (connector.variant === "account" && (connector.authRequirement !== "required" || !hasLogin || !accountPermission)) {
          errors.push("account connector variants require required auth, login capability, and permissions.account");
        }
        if ((connector.authRequirement === "optional" || connector.authRequirement === "required") && !hasLogin) {
          errors.push("optional or required connector auth needs the login capability");
        }
      }
    }
    return { valid: errors.length === 0, errors, manifest: typed };
  } catch (error) {
    return { valid: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

export function buildStoreRecord(manifest: ImplementationManifest, now = new Date()): Record<string, unknown> {
  const timestamp = now.toISOString();
  const repository = manifest.repository.replace(/\/$/, "");
  if (manifest.kind === "plugin") {
    if (manifest.license.commercialUse === undefined) {
      throw new Error("plugin licenses must declare commercialUse");
    }
    if (manifest.permissions && !Array.isArray(manifest.permissions)) {
      throw new Error("plugin permissions must be an array");
    }
    return {
      schemaVersion: "1",
      id: manifest.id,
      name: manifest.name,
      summary: manifest.summary,
      version: manifest.version,
      publisher: manifest.publisher,
      repository,
      license: manifest.license,
      compatibility: { protocolPackage: manifest.protocol.package, protocolVersion: manifest.protocol.range },
      distribution: {
        url: manifest.artifact.url,
        format: "esm",
        ...(manifest.artifact.integrity ? { integrity: manifest.artifact.integrity } : {}),
        ...(manifest.artifact.mirrors ? { mirrors: manifest.artifact.mirrors } : {}),
      },
      ...(manifest.releaseNotesUrl ? { releaseNotesUrl: manifest.releaseNotesUrl } : {}),
      ...(manifest.publishedAt ? { publishedAt: manifest.publishedAt } : {}),
      capabilities: [...(manifest.capabilities ?? [])].sort(),
      permissions: [...(manifest.permissions ?? [])].sort(),
      tags: [...(manifest.tags ?? [])].sort(),
      status: "published",
      submittedAt: timestamp,
      updatedAt: timestamp,
    };
  }
  if (Array.isArray(manifest.permissions)) throw new Error("connector permissions must be an object");
  if (!manifest.artifact.integrity) throw new Error("connector artifacts require integrity before Store submission");
  return {
    schemaVersion: 1,
    id: manifest.id,
    familyId: manifest.connector!.familyId,
    variant: manifest.connector!.variant,
    authRequirement: manifest.connector!.authRequirement,
    platforms: manifest.connector!.platforms,
    name: manifest.name,
    description: manifest.summary,
    publisher: manifest.publisher,
    repository,
    license: manifest.license.name,
    version: manifest.version,
    protocolVersion: manifest.protocol.range,
    capabilities: [...(manifest.capabilities ?? [])].sort(),
    artifact: {
      url: manifest.artifact.url,
      format: "esm",
      ...(manifest.artifact.integrity ? { integrity: manifest.artifact.integrity } : {}),
      ...(manifest.artifact.mirrors ? { mirrors: manifest.artifact.mirrors } : {}),
    },
    ...(manifest.releaseNotesUrl ? { releaseNotesUrl: manifest.releaseNotesUrl } : {}),
    ...(manifest.publishedAt ? { publishedAt: manifest.publishedAt } : {}),
    ...(manifest.permissions ? { permissions: manifest.permissions } : {}),
    tags: [...(manifest.tags ?? [])].sort(),
    status: "active",
    submittedAt: timestamp,
    updatedAt: timestamp,
  };
}
