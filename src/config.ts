/** 環境変数の読み取り。実値はコミットせず .env.example に名前だけ置く。 */
export const config = {
  port: Number(process.env.PORT ?? 3100),
  /** SQLite のファイルパス。data/ は .gitignore 済み。 */
  dbPath: process.env.DB_PATH ?? 'data/signboard.sqlite',
};
