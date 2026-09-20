/**
 * 環境変数の読み取り。実値はコミットせず .env に置く。
 * Node v24 は --env-file で .env を読める（npm scripts で指定）。
 */

/** 必須の環境変数。欠けていたら起動時に落とす（動いてから気づくより良い）。 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `環境変数 ${name} が設定されていません。.env.example を参考に .env を作成してください。`,
    );
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3100),
  /** SQLite のファイルパス。data/ は .gitignore 済み。 */
  dbPath: process.env.DB_PATH ?? 'data/signboard.sqlite',
  /** 外部に見えるベースURL。OAuth のリダイレクト先の組み立てに使う。 */
  baseUrl: process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3100}`,
};

/**
 * 認証まわりの設定。掲示板の表示（認証不要）だけなら無くても動くので、
 * 使う直前に読み込む形にして、未設定でも開発サーバーが起動できるようにする。
 */
export function authConfig() {
  return {
    clientId: required('DISCORD_CLIENT_ID'),
    clientSecret: required('DISCORD_CLIENT_SECRET'),
    botToken: required('DISCORD_BOT_TOKEN'),
    guildId: required('DISCORD_GUILD_ID'),
    residentRoleId: required('DISCORD_RESIDENT_ROLE_ID'),
    sessionSecret: required('SESSION_SECRET'),
    redirectUri: `${config.baseUrl}/auth/callback`,
  };
}

export type AuthConfig = ReturnType<typeof authConfig>;
