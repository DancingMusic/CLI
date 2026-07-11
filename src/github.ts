import type { ImplementationManifest } from "./types.js";

const api = "https://api.github.com";

export interface DeviceAuthorization {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

async function formPost<T>(url: string, values: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
  });
  if (!response.ok) throw new Error(`GitHub authentication failed (${response.status})`);
  return response.json() as Promise<T>;
}

export function requireClientId(): string {
  const clientId = process.env.DANCINGMUSIC_GITHUB_CLIENT_ID;
  if (!clientId) throw new Error("DANCINGMUSIC_GITHUB_CLIENT_ID is not configured");
  return clientId;
}

export async function startDeviceFlow(clientId = requireClientId()): Promise<DeviceAuthorization> {
  return formPost("https://github.com/login/device/code", { client_id: clientId, scope: "public_repo" });
}

export async function pollDeviceFlow(auth: DeviceAuthorization, clientId = requireClientId()): Promise<string> {
  const deadline = Date.now() + auth.expires_in * 1000;
  let interval = auth.interval;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));
    const result = await formPost<{ access_token?: string; error?: string }>(
      "https://github.com/login/oauth/access_token",
      { client_id: clientId, device_code: auth.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" },
    );
    if (result.access_token) return result.access_token;
    if (result.error === "slow_down") { interval += 5; continue; }
    if (result.error === "authorization_pending") continue;
    throw new Error(`GitHub device authorization failed: ${result.error ?? "unknown error"}`);
  }
  throw new Error("GitHub device authorization expired");
}

export function storeRepository(manifest: ImplementationManifest): "DancingStore" | "MusicStore" {
  return manifest.kind === "plugin" ? "DancingStore" : "MusicStore";
}

export async function githubRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub API request failed (${response.status}): ${detail.slice(0, 300)}`);
  }
  return response.json() as Promise<T>;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function submitStoreRecord(
  manifest: ImplementationManifest,
  record: Record<string, unknown>,
  token: string,
): Promise<string> {
  const store = storeRepository(manifest);
  const upstream = `DancingMusic/${store}`;
  const viewer = await githubRequest<{ login: string }>("/user", token);
  const repository = await githubRequest<{ default_branch: string }>(`/repos/${upstream}`, token);
  const base = repository.default_branch;
  const baseRef = await githubRequest<{ object: { sha: string } }>(
    `/repos/${upstream}/git/ref/heads/${encodeURIComponent(base)}`,
    token,
  );

  let forkReady = false;
  try {
    await githubRequest(`/repos/${viewer.login}/${store}`, token);
    forkReady = true;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("(404)")) throw error;
    await githubRequest(`/repos/${upstream}/forks`, token, { method: "POST" });
  }
  for (let attempt = 0; !forkReady && attempt < 15; attempt += 1) {
    await delay(1000);
    try {
      await githubRequest(`/repos/${viewer.login}/${store}`, token);
      forkReady = true;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("(404)")) throw error;
    }
  }
  if (!forkReady) throw new Error(`Timed out waiting for ${viewer.login}/${store} fork`);

  const branch = `submit/${manifest.kind}-${manifest.id}-${manifest.version}`;
  const existing = await githubRequest<Array<{ html_url: string }>>(
    `/repos/${upstream}/pulls?state=open&head=${encodeURIComponent(`${viewer.login}:${branch}`)}`,
    token,
  );
  if (existing[0]) return existing[0].html_url;

  try {
    await githubRequest(`/repos/${viewer.login}/${store}/git/refs`, token, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseRef.object.sha }),
    });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("Reference already exists")) throw error;
    throw new Error(`Submission branch ${branch} already exists without an open pull request; remove it manually or bump the version`);
  }

  const path = manifest.kind === "plugin"
    ? `registry/${manifest.id}.json`
    : `registry/manifests/${manifest.id}.json`;
  const content = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf8").toString("base64");
  await githubRequest(`/repos/${viewer.login}/${store}/contents/${path}`, token, {
    method: "PUT",
    body: JSON.stringify({
      message: `registry: submit ${manifest.id} ${manifest.version}`,
      content,
      branch,
    }),
  });

  const pull = await githubRequest<{ html_url: string }>(`/repos/${upstream}/pulls`, token, {
    method: "POST",
    body: JSON.stringify({
      title: `registry: ${manifest.id} ${manifest.version}`,
      head: `${viewer.login}:${branch}`,
      base,
      body: [
        "Submitted with `@dancingmusic/cli`.",
        "",
        `- Implementation: ${manifest.repository}`,
        `- Version: ${manifest.version}`,
        `- Artifact: ${manifest.artifact.url}`,
        `- Protocol: ${manifest.protocol.package} ${manifest.protocol.range}`,
        "",
        "This pull request is a proposal and remains subject to Store CI and maintainer review.",
      ].join("\n"),
    }),
  });
  return pull.html_url;
}
