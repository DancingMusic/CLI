const service = "dancingmusic-cli";
const account = "github";

async function keytar() {
  try {
    return await import("keytar");
  } catch {
    return undefined;
  }
}

export async function saveToken(token: string): Promise<boolean> {
  const store = await keytar();
  if (!store) return false;
  await store.setPassword(service, account, token);
  return true;
}

export async function readToken(): Promise<string | undefined> {
  if (process.env.DANCINGMUSIC_GITHUB_TOKEN) return process.env.DANCINGMUSIC_GITHUB_TOKEN;
  const store = await keytar();
  return (await store?.getPassword(service, account)) ?? undefined;
}

export async function deleteToken(): Promise<void> {
  const store = await keytar();
  await store?.deletePassword(service, account);
}
