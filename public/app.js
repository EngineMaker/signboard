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

var els = {
  date: document.getElementById('date'),
  time: document.getElementById('time'),
  track: document.getElementById('track'),
  content: document.getElementById('content'),
  status: document.getElementById('status'),
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
 * お知らせを1本の帯に連結する。
 * 0件なら設定のフォールバック文言を出す（SPEC §2.2）。
 */
function buildContent(data) {
  var notices = (data && data.notices) || [];
  var settings = (data && data.settings) || {};

  if (notices.length === 0) {
    var fallback = settings.fallbackText || 'お知らせ募集中';
    return [{ text: fallback }];
  }
  return notices.map(function (n) {
    return { text: n.body };
  });
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
  var items = buildContent(data);
  var key = JSON.stringify(items) + '|' + JSON.stringify(data && data.settings);

  // 内容が同じなら何もしない。再描画するとスクロールが先頭に戻ってしまう。
  if (key === renderedKey) return;
  renderedKey = key;

  els.content.textContent = '';
  items.forEach(function (item, i) {
    if (i > 0) {
      var sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '●';
      els.content.appendChild(sep);
    }
    els.content.appendChild(document.createTextNode(item.text));
  });

  applySettings(data && data.settings);

  // レイアウト確定後に幅を測る
  requestAnimationFrame(function () {
    applyScrollDuration(data && data.settings);
  });
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
      render(data);
      renderStatus();
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

  fetchNotices();
  setPollInterval(POLL_INTERVAL_FALLBACK_MS);
  setInterval(renderStatus, 10000);
  connectStream();

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
