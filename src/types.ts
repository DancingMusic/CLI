export type ProjectKind = "plugin" | "connector";

export interface ImplementationManifest {
  schemaVersion: 1;
  kind: ProjectKind;
  id: string;
  name: string;
  summary: string;
  version: string;
  publisher: { name: string; url: string };
  repository: string;
  license: { name: string; url: string; commercialUse?: boolean };
  protocol: { package: string; range: string };
  artifact: {
    url: string;
    integrity?: string;
    mirrors?: Array<{ region: "global" | "china"; url: string }>;
  };
  releaseNotesUrl?: string;
  publishedAt?: string;
  capabilities?: string[];
  permissions?: string[] | { networkOrigins?: string[]; artworkOrigins?: string[]; account?: boolean };
  connector?: {
    familyId: string;
    variant: "anonymous" | "account" | "hybrid";
    authRequirement: "none" | "optional" | "required";
    platforms: Array<"web" | "desktop">;
  };
  tags?: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  manifest?: ImplementationManifest;
}
