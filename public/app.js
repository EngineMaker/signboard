/*
 * 掲示板画面のロジック。
 * Safari 16 が対象なのでビルド工程なし、素の ES2022 で書く。
 *
 * 方針（SPEC §2.4）: サーバーが落ちても画面は止めない。
 * 取得できた内容は localStorage に保存し、起動時はまずそれを表示してから通信する。
 */
'use strict';

var CACHE_KEY = 'signboard.cache.v1';
/** SSE が生きているときの保険のポーリング間隔 */
var POLL_INTERVAL_SSE_MS = 300000;
/** SSE が使えないときのポーリング間隔 */
var POLL_INTERVAL_FALLBACK_MS = 30000;
/** この時間だけ取得できなければ「オフライン」と見なす */
var STALE_THRESHOLD_MS = 90000;
/** 再接続の待ち時間（指数バックオフの上限） */
var RECONNECT_MAX_MS = 30000;
/**
 * 投稿からこの時間だけ「新着」として扱う。
 * その間はその1件だけを流し、過ぎたら通常のローテーションに戻る。
 */
var NEW_WINDOW_MS = 5 * 60 * 1000;

var els = {
  date: document.getElementById('date'),
  time: document.getElementById('time'),
  track: document.getElementById('track'),
  content: document.getElementById('content'),
  status: document.getElementById('status'),
  latest: document.getElementById('latest'),
  flash: document.getElementById('flash'),
};

/** 直近で取得に成功した時刻。null なら一度も成功していない。 */
var lastFetchOk = null;
/** SSE の接続。null なら未接続。 */
var eventSource = null;
/** 再接続の待ち時間。失敗するたびに伸ばす。 */
var reconnectDelay = 1000;
/** ポーリングのタイマー。SSE の状態に応じて間隔を変える。 */
var pollTimer = null;
/** 表示中の内容。差分がなければ DOM に触らずアニメーションを途切れさせない。 */
var renderedKey = '';
/** 新着の表示が切れる時刻。過ぎたら通常表示に戻す。 */
var newUntil = 0;
/**
 * すでに光らせた新着の ID。
 * 再描画のたびに光ると鬱陶しいので、1件につき1回だけにする。
 * 起動直後に既存のお知らせで光らないよう、最初の取得では記録だけして光らせない。
 */
var flashedIds = {};
var hasLoadedOnce = false;

// ---- 時計 ----

var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function renderClock() {
  var now = new Date();
  els.date.textContent =
    now.getMonth() + 1 + '月' + now.getDate() + '日(' + WEEKDAYS[now.getDay()] + ')';
  els.time.textContent = now.getHours() + ':' + pad2(now.getMinutes());
}

// ---- キャッシュ ----

function readCache() {
  try {
    var raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    // プライベートブラウズ等で読めないことがある。無くても動く。
    return null;
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data: data, savedAt: Date.now() }));
  } catch (e) {
    /* 容量超過などは無視 */
  }
}

// ---- 描画 ----

/**
 * 投稿から NEW_WINDOW_MS 以内のお知らせを返す。無ければ null。
 *
 * リビングに居続ける人は、内容が変わっても気づけない。
 * 新着が出たらそれだけを流して、変化があったことを分かるようにする。
 */
function findNewNotice(data, now) {
  var notices = (data && data.notices) || [];
  var newest = null;

  for (var i = 0; i < notices.length; i++) {
    var n = notices[i];
    if (typeof n.createdAt !== 'number') continue;
    if (now - n.createdAt > NEW_WINDOW_MS) continue;
    if (!newest || n.createdAt > newest.createdAt) newest = n;
  }
  return newest;
}

/**
 * お知らせを1本の帯に連結する。
 * 0件なら設定のフォールバック文言を出す（SPEC §2.2）。
 *
 * 新着があるときは、その1件だけを強調して流す。
 * 複数件を連結したままだと、新しいものが末尾に紛れて一周待つことになる。
 */
function buildContent(data, now) {
  var notices = (data && data.notices) || [];
  var settings = (data && data.settings) || {};

  if (notices.length === 0) {
    var fallback = settings.fallbackText || 'お知らせ募集中';
    return { items: [{ text: fallback }], isNew: false };
  }

  var fresh = findNewNotice(data, now);
  if (fresh) {
    newUntil = fresh.createdAt + NEW_WINDOW_MS;
    return { items: [{ text: fresh.body, isNew: true }], isNew: true };
  }

  return {
    items: notices.map(function (n) {
      return { text: n.body };
    }),
    isNew: false,
  };
}

function applySettings(settings) {
  if (!settings) return;
  var root = document.documentElement;

  if (typeof settings.fontScale === 'number') {
    root.style.setProperty('--font-scale', String(settings.fontScale));
  }
  if (typeof settings.theme === 'string') {
    root.setAttribute('data-theme', settings.theme);
  }

  // 光り方は CSS 側で切り替える
  if (typeof settings.flashStyle === 'string') {
    document.body.setAttribute('data-flash', settings.flashStyle);
  }
}

/**
 * スクロール速度を、内容の長さから所要時間に換算して設定する。
 * 速度(px/秒) を保つため、文字数が増えたら時間も伸ばす。
 */
function applyScrollDuration(settings) {
  var speed = settings && typeof settings.scrollSpeed === 'number' ? settings.scrollSpeed : 220;
  if (speed <= 0) speed = 220;

  // 帯の幅 + 画面幅ぶん動く
  var distance = els.track.scrollWidth + window.innerWidth;
  var seconds = distance / speed;

  document.documentElement.style.setProperty('--scroll-duration', seconds.toFixed(2) + 's');
}

function render(data) {
  var now = Date.now();
  var built = buildContent(data, now);
  var items = built.items;
  var key = JSON.stringify(items) + '|' + JSON.stringify(data && data.settings);

  // 内容が同じなら何もしない。再描画するとスクロールが先頭に戻ってしまう。
  if (key === renderedKey) return;
  renderedKey = key;

  els.content.textContent = '';

  if (built.isNew) {
    // 新着であることを示す印。文字と一緒に流れる。
    var badge = document.createElement('span');
    badge.className = 'badge-new';
    badge.textContent = 'NEW';
    els.content.appendChild(badge);
  }

  items.forEach(function (item, i) {
    if (i > 0) {
      var sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '●';
      els.content.appendChild(sep);
    }
    els.content.appendChild(document.createTextNode(item.text));
  });

  // 新着の間は画面全体を琥珀寄りにして、視界の端でも変化が分かるようにする
  document.body.classList.toggle('is-new', built.isNew);

  applySettings(data && data.settings);
  renderLatestAt(data);

  // レイアウト確定後に幅を測る
  requestAnimationFrame(function () {
    applyScrollDuration(data && data.settings);
  });
}

/** 最後にお知らせが追加された時刻を隅に出す。いつから変わっていないかが分かる。 */
function renderLatestAt(data) {
  var el = els.latest;
  if (!el) return;

  var at = data && data.latestAt;
  if (!at) {
    el.hidden = true;
    return;
  }

  var d = new Date(at);
  var sameDay = new Date().toDateString() === d.toDateString();
  var time = d.getHours() + ':' + pad2(d.getMinutes());

  el.textContent = '最終更新 ' + (sameDay ? time : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + time);
  el.hidden = false;
}

/**
 * 画面を一瞬光らせる。
 *
 * 起動直後は光らせない（既にあるお知らせで驚かせないため）。
 * 同じお知らせで二度光ることもない。
 */
function maybeFlash(data) {
  var fresh = findNewNotice(data, Date.now());

  if (!fresh) return;
  if (flashedIds[fresh.id]) return;

  flashedIds[fresh.id] = true;

  // 初回の取得では記録だけして光らせない
  if (!hasLoadedOnce) return;

  var settings = (data && data.settings) || {};
  if (settings.flashStyle === 'off') return;

  // CSS が見る属性を、描画より先に合わせておく
  if (typeof settings.flashStyle === 'string') {
    document.body.setAttribute('data-flash', settings.flashStyle);
  }

  var el = els.flash;
  if (!el) return;

  // アニメーションを繰り返せるよう、一度クラスを外して再適用する
  el.classList.remove('is-flashing');
  void el.offsetWidth;
  el.classList.add('is-flashing');
}

// ---- 状態表示 ----

function renderStatus() {
  if (lastFetchOk === null) {
    // 一度も取得できていない。キャッシュから復元した内容を出している場合。
    var cached = readCache();
    if (cached) {
      showStatus('オフライン（保存済みの内容）');
    } else {
      showStatus('接続中…');
    }
    return;
  }

  var age = Date.now() - lastFetchOk;
  if (age > STALE_THRESHOLD_MS) {
    showStatus('オフライン・最終更新 ' + formatAge(age));
  } else {
    els.status.hidden = true;
  }
}

function showStatus(text) {
  els.status.textContent = text;
  els.status.hidden = false;
}

function formatAge(ms) {
  var min = Math.floor(ms / 60000);
  if (min < 60) return min + '分前';
  var hours = Math.floor(min / 60);
  if (hours < 24) return hours + '時間前';
  return Math.floor(hours / 24) + '日前';
}

// ---- 取得 ----

function fetchNotices() {
  // iOS Safari はレスポンスを積極的にキャッシュするため毎回クエリを変える
  return fetch('/api/notices?t=' + Date.now(), { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      lastFetchOk = Date.now();
      writeCache(data);
      maybeFlash(data);
      render(data);
      renderStatus();
      hasLoadedOnce = true;
    })
    .catch(function () {
      // 取得できなくても表示は維持する。状態表示だけ更新。
      renderStatus();
    });
}

// ---- リアルタイム更新 (SSE) ----

/**
 * サーバーから「変わった」合図を受け取る。
 * 中身は送られてこないので、合図を受けたら通常の取得を走らせる。
 *
 * EventSource は iPadOS 16 の Safari でも使える。
 * 切れたら自動再接続するが、サーバー停止時に無駄な再試行を重ねないよう
 * 自前でバックオフを入れ、その間はポーリングで凌ぐ。
 */
function connectStream() {
  if (!window.EventSource) return; // 念のため。使えなければポーリングのみ

  try {
    eventSource = new EventSource('/api/stream');
  } catch (e) {
    setPollInterval(POLL_INTERVAL_FALLBACK_MS);
    return;
  }

  eventSource.addEventListener('connected', function () {
    reconnectDelay = 1000;
    // SSE が生きている間はポーリングを緩める（保険として残す）
    setPollInterval(POLL_INTERVAL_SSE_MS);
  });

  ['notices-changed', 'settings-changed'].forEach(function (name) {
    eventSource.addEventListener(name, function () {
      fetchNotices();
    });
  });

  // 管理画面から「試してみる」を押されたとき。取得はせず、光らせるだけ。
  eventSource.addEventListener('flash-test', function () {
    var cached = readCache();
    var settings = (cached && cached.data && cached.data.settings) || {};
    if (settings.flashStyle === 'off') return;

    if (typeof settings.flashStyle === 'string') {
      document.body.setAttribute('data-flash', settings.flashStyle);
    }
    if (els.flash) {
      els.flash.classList.remove('is-flashing');
      void els.flash.offsetWidth;
      els.flash.classList.add('is-flashing');
    }
  });

  eventSource.onerror = function () {
    // EventSource は自動再接続するが、サーバーが落ちている間は
    // ポーリングに戻しておく（そちらがキャッシュ表示の維持も担う）。
    setPollInterval(POLL_INTERVAL_FALLBACK_MS);

    if (eventSource && eventSource.readyState === EventSource.CLOSED) {
      eventSource = null;
      setTimeout(connectStream, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    }
  };
}

/** ポーリング間隔を切り替える。 */
function setPollInterval(ms) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(fetchNotices, ms);
}

// ---- 全画面表示（パソコン用） ----

/*
 * iPad は「ホーム画面に追加」で全画面になるので、このボタンは出さない。
 * 判定は「マウスが使えるか」で行う。タッチ端末では hover が効かないため。
 */
function setupFullscreen() {
  var button = document.getElementById('fullscreen');
  if (!button) return;

  var canFullscreen = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  var hasMouse = window.matchMedia && window.matchMedia('(hover: hover)').matches;

  // すでに全画面で開いている場合（ホーム画面から起動した iPad など）も出さない
  var standalone = window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

  if (!canFullscreen || !hasMouse || standalone) return;

  button.hidden = false;

  button.addEventListener('click', toggleFullscreen);

  // マウスを動かしたときだけ表示し、しばらく止まったら消す
  var hideTimer = null;
  document.addEventListener('mousemove', function () {
    document.body.classList.add('is-pointing');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      document.body.classList.remove('is-pointing');
    }, 2500);
  });

  // f キーでも切り替えられる
  document.addEventListener('keydown', function (e) {
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      toggleFullscreen();
    }
  });

  // 状態が変わったらアイコンを入れ替える
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (name) {
    document.addEventListener(name, updateFullscreenIcon);
  });
}

function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

function toggleFullscreen() {
  var el = document.documentElement;
  if (isFullscreen()) {
    var exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) exit.call(document);
  } else {
    var request = el.requestFullscreen || el.webkitRequestFullscreen;
    // ブラウザに拒否されることがあるので、失敗しても画面は壊さない
    if (request) {
      try {
        var result = request.call(el);
        if (result && result.catch) result.catch(function () {});
      } catch (e) { /* 無視 */ }
    }
  }
}

function updateFullscreenIcon() {
  var icon = document.getElementById('fs-icon');
  var button = document.getElementById('fullscreen');
  if (!icon || !button) return;

  if (isFullscreen()) {
    // 内向きの矢印（戻す）
    icon.setAttribute('d', 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5');
    button.setAttribute('aria-label', '全画面表示をやめる');
    button.setAttribute('title', '全画面をやめる (f)');
  } else {
    // 外向きの矢印（広げる）
    icon.setAttribute('d', 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5');
    button.setAttribute('aria-label', '全画面表示にする');
    button.setAttribute('title', '全画面表示 (f)');
  }
}

// ---- 起動 ----

function start() {
  renderClock();
  setInterval(renderClock, 1000);

  // まずキャッシュを描画。通信を待たずに画面が立ち上がる。
  var cached = readCache();
  if (cached && cached.data) {
    render(cached.data);
  }
  renderStatus();

  setupFullscreen();

  fetchNotices();
  setPollInterval(POLL_INTERVAL_FALLBACK_MS);
  setInterval(renderStatus, 10000);
  connectStream();

  // 新着の表示期間が切れたら、通常のローテーションに戻す。
  // 通信は発生しないので、キャッシュから描き直すだけ。
  setInterval(function () {
    if (newUntil && Date.now() > newUntil) {
      newUntil = 0;
      var cached = readCache();
      if (cached && cached.data) render(cached.data);
    }
  }, 5000);

  // 画面復帰時（スリープ明け）は即座に取り直す。
  // スリープ中に SSE が切れていることが多いので、繋ぎ直しも試みる。
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    fetchNotices();
    if (!eventSource) connectStream();
  });

  window.addEventListener('online', function () {
    fetchNotices();
    if (!eventSource) connectStream();
  });

  // 画面回転などで幅が変わったらスクロール時間を測り直す
  window.addEventListener('resize', function () {
    var cache = readCache();
    applyScrollDuration(cache && cache.data && cache.data.settings);
  });
}

start();
