/**
 * 認証が必要なページの OGP カード対応。
 *
 * Discord などのクローラーはログインできないため、/admin/ をそのまま
 * ガードするとカードに何も出ない。クローラーにはメタタグだけの HTML を返す。
 *
 * これは「認証を迂回する穴」ではない。返すのはページの題名と説明と絵だけで、
 * 中身（お知らせ一覧・APIキー・操作履歴）は一切含まない。
 */

/**
 * リンクのプレビューを取りに来る相手かどうか。
 *
 * User-Agent は詐称できるが、ここで判定を誤っても漏れるのは
 * 公開して構わない情報だけなので、緩めの判定で足りる。
 */
const CRAWLER_PATTERN =
  /(discordbot|slackbot|twitterbot|facebookexternalhit|linkedinbot|telegrambot|whatsapp|line-poker|embedly|bingbot|googlebot|applebot|skypeuripreview|redditbot|mastodon|pleroma|misskey)/i;

export function isCrawler(userAgent: string | undefined): boolean {
  if (!userAgent) return false;
  return CRAWLER_PATTERN.test(userAgent);
}

export interface CardInfo {
  title: string;
  description: string;
  url: string;
  image: string;
  imageAlt: string;
  siteName: string;
}

/** メタタグだけの最小の HTML。本文は表示されない前提。 */
export function renderCard(card: CardInfo): string {
  const esc = (v: string) =>
    v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${esc(card.title)}</title>
<meta name="description" content="${esc(card.description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(card.siteName)}">
<meta property="og:title" content="${esc(card.title)}">
<meta property="og:description" content="${esc(card.description)}">
<meta property="og:url" content="${esc(card.url)}">
<meta property="og:image" content="${esc(card.image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(card.imageAlt)}">
<meta property="og:locale" content="ja_JP">
<meta name="twitter:card" content="summary_large_image">
</head>
<body>
<p>${esc(card.title)} — ログインが必要です。</p>
</body>
</html>`;
}
