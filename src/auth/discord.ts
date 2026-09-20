/**
 * Discord API の薄いラッパ。
 * ここが破れると誰でも掲示板に書けるため、検証は「ロールを持っていることが確認できた場合だけ通す」
 * という向き（失敗時は必ず false）で実装する。
 */

const API = 'https://discord.com/api/v10';

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export class DiscordError extends Error {
  // パラメータプロパティ（constructor 引数に修飾子を付ける書き方）は
  // Node の型除去のみの実行では使えないため、通常のフィールドとして宣言する。
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'DiscordError';
    this.status = status;
  }
}

/** 認可コードをアクセストークンに交換する。 */
export async function exchangeCode(
  code: string,
  opts: { clientId: string; clientSecret: string; redirectUri: string },
): Promise<TokenResponse> {
  const res = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: opts.redirectUri,
    }),
  });

  if (!res.ok) {
    throw new DiscordError(`token exchange failed: ${res.status}`, res.status);
  }
  return (await res.json()) as TokenResponse;
}

/** アクセストークンでログイン中のユーザー情報を取る。 */
export async function fetchCurrentUser(accessToken: string): Promise<DiscordUser> {
  const res = await fetch(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new DiscordError(`fetch user failed: ${res.status}`, res.status);
  }
  return (await res.json()) as DiscordUser;
}

/**
 * ギルドメンバーのロールを Bot トークンで取得する。
 *
 * OAuth の access_token ではなく Bot トークンで引くのは、
 * ユーザー側のスコープ設定に依存せず確実にロールを見るため。
 *
 * @returns ロールID の配列。メンバーでない場合は null。
 */
export async function fetchMemberRoles(
  userId: string,
  opts: { botToken: string; guildId: string },
): Promise<string[] | null> {
  const res = await fetch(`${API}/guilds/${opts.guildId}/members/${userId}`, {
    headers: { Authorization: `Bot ${opts.botToken}` },
  });

  // サーバーに居ない
  if (res.status === 404) return null;

  if (!res.ok) {
    throw new DiscordError(`fetch member failed: ${res.status}`, res.status);
  }

  const member = (await res.json()) as { roles?: string[] };
  return member.roles ?? [];
}

/** 表示名。global_name があればそちらを優先する。 */
export function displayName(user: DiscordUser): string {
  return user.global_name ?? user.username;
}

/** 認可画面の URL を組み立てる。 */
export function authorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: 'identify',
    state: opts.state,
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}
