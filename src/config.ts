/** 環境変数の読み取り。実値はコミットせず .env.example に名前だけ置く。 */
export const config = {
  port: Number(process.env.PORT ?? 3100),
};
