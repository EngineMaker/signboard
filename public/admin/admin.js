/*
 * 管理画面。掲示板と同じくビルド工程なし。
 * 住人がスマホから使うので、操作は少ないタップで終わるように保つ。
 */
'use strict';

var HOUR_MS = 3600000;

// ---- 共通 ----

function api(path, options) {
  return fetch('/api/admin' + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options))
    .then(function (res) {
      if (res.status === 401) {
        location.href = '/auth/login';
        throw new Error('unauthorized');
      }
      return res.json().then(function (body) {
        if (!res.ok) throw new Error(body.error || 'エラーが発生しました');
        return body;
      });
    });
}

var toastTimer = null;
function toast(message, isError) {
  var el = document.getElementById('toast');
  el.textContent = message;
  el.className = 'toast' + (isError ? ' is-error' : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
}

function formatTime(ms) {
  var d = new Date(ms);
  var pad = function (n) { return n < 10 ? '0' + n : n; };
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + pad(d.getMinutes());
}

function formatRemaining(expiresAt, now) {
  var diff = expiresAt - now;
  if (diff <= 0) return '期限切れ';
  var h = Math.floor(diff / HOUR_MS);
  if (h < 1) return 'あと' + Math.max(1, Math.floor(diff / 60000)) + '分';
  if (h < 24) return 'あと' + h + '時間';
  return 'あと' + Math.floor(h / 24) + '日';
}

// ---- タブ ----

function setupTabs() {
  var tabs = document.querySelectorAll('.tab');
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (t) { t.classList.remove('is-active'); });
      tab.classList.add('is-active');

      var name = tab.dataset.tab;
      ['notices', 'settings', 'audit'].forEach(function (p) {
        document.getElementById('panel-' + p).hidden = p !== name;
      });

      if (name === 'settings') loadSettings();
      if (name === 'audit') loadAuditLogs();
    });
  });
}

// ---- お知らせ ----

function renderNotices(data) {
  var list = document.getElementById('notice-list');
  list.textContent = '';

  if (data.notices.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'お知らせはまだありません';
    list.appendChild(empty);
    return;
  }

  data.notices.forEach(function (n) {
    var expired = n.expires_at <= data.now;

    var item = document.createElement('div');
    item.className = 'item' + (expired ? ' is-expired' : '');

    var body = document.createElement('p');
    body.className = 'item-body';
    body.textContent = n.body;
    item.appendChild(body);

    var meta = document.createElement('div');
    meta.className = 'item-meta';
    [
      n.author_name,
      formatTime(n.created_at),
      formatRemaining(n.expires_at, data.now),
      n.source,
    ].forEach(function (text) {
      var span = document.createElement('span');
      if (text === n.source) span.className = 'badge';
      span.textContent = text;
      meta.appendChild(span);
    });
    item.appendChild(meta);

    var actions = document.createElement('div');
    actions.className = 'item-actions';

    var editBtn = document.createElement('button');
    editBtn.textContent = '編集';
    editBtn.addEventListener('click', function () { editNotice(n); });
    actions.appendChild(editBtn);

    var delBtn = document.createElement('button');
    delBtn.className = 'danger';
    delBtn.textContent = '削除';
    delBtn.addEventListener('click', function () { removeNotice(n); });
    actions.appendChild(delBtn);

    item.appendChild(actions);
    list.appendChild(item);
  });
}

function loadNotices() {
  return api('/notices').then(renderNotices).catch(function (e) { toast(e.message, true); });
}

function editNotice(notice) {
  var next = prompt('お知らせを編集', notice.body);
  if (next === null || next.trim() === '' || next === notice.body) return;

  api('/notices/' + notice.id, { method: 'PATCH', body: JSON.stringify({ body: next.trim() }) })
    .then(function () { toast('更新しました'); return loadNotices(); })
    .catch(function (e) { toast(e.message, true); });
}

function removeNotice(notice) {
  var preview = notice.body.length > 20 ? notice.body.slice(0, 20) + '…' : notice.body;
  if (!confirm('削除しますか？\n\n' + preview)) return;

  api('/notices/' + notice.id, { method: 'DELETE' })
    .then(function () { toast('削除しました'); return loadNotices(); })
    .catch(function (e) { toast(e.message, true); });
}

function setupNoticeForm() {
  var form = document.getElementById('new-notice');
  var bodyEl = document.getElementById('new-body');
  var countEl = document.getElementById('new-count');

  bodyEl.addEventListener('input', function () {
    countEl.textContent = String(bodyEl.value.length);
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var body = bodyEl.value.trim();
    if (!body) { toast('本文を入力してください', true); return; }

    var hours = document.getElementById('new-expiry').value;
    var payload = { body: body };
    if (hours) payload.expiresAt = Date.now() + Number(hours) * HOUR_MS;

    var button = form.querySelector('button[type="submit"]');
    button.disabled = true;

    api('/notices', { method: 'POST', body: JSON.stringify(payload) })
      .then(function () {
        bodyEl.value = '';
        countEl.textContent = '0';
        toast('投稿しました');
        return loadNotices();
      })
      .catch(function (e) { toast(e.message, true); })
      .finally(function () { button.disabled = false; });
  });
}

// ---- 表示設定 ----

function loadSettings() {
  return api('/settings').then(function (data) {
    var s = data.settings;
    document.getElementById('scrollSpeed').value = s.scrollSpeed;
    document.getElementById('fontScale').value = s.fontScale;
    document.getElementById('fallbackText').value = s.fallbackText;
    updateSettingLabels();
  }).catch(function (e) { toast(e.message, true); });
}

function updateSettingLabels() {
  document.getElementById('speed-value').textContent = document.getElementById('scrollSpeed').value;
  document.getElementById('font-value').textContent = document.getElementById('fontScale').value;
}

function setupSettingsForm() {
  ['scrollSpeed', 'fontScale'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', updateSettingLabels);
  });

  document.getElementById('settings-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var payload = {
      scrollSpeed: Number(document.getElementById('scrollSpeed').value),
      fontScale: Number(document.getElementById('fontScale').value),
      fallbackText: document.getElementById('fallbackText').value.trim(),
    };

    api('/settings', { method: 'PATCH', body: JSON.stringify(payload) })
      .then(function () {
        toast('保存しました');
        var status = document.getElementById('settings-status');
        status.textContent = '保存しました';
        setTimeout(function () { status.textContent = ''; }, 2600);
      })
      .catch(function (e) { toast(e.message, true); });
  });
}

// ---- 操作履歴 ----

var ACTION_LABELS = {
  'notice.create': 'お知らせを投稿',
  'notice.update': 'お知らせを編集',
  'notice.delete': 'お知らせを削除',
  'settings.update': '表示設定を変更',
  'apikey.create': 'APIキーを発行',
  'apikey.revoke': 'APIキーを失効',
};

function renderAuditLogs(data) {
  var filter = document.getElementById('audit-filter');
  if (filter.options.length === 1) {
    data.actions.forEach(function (a) {
      var opt = document.createElement('option');
      opt.value = a;
      opt.textContent = ACTION_LABELS[a] || a;
      filter.appendChild(opt);
    });
  }

  var list = document.getElementById('audit-list');
  list.textContent = '';

  if (data.logs.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '記録はまだありません';
    list.appendChild(empty);
    return;
  }

  data.logs.forEach(function (log) {
    var item = document.createElement('div');
    item.className = 'item log';

    var head = document.createElement('p');
    head.className = 'item-body';
    head.textContent = log.actor_name + ' が ' + (ACTION_LABELS[log.action] || log.action);
    item.appendChild(head);

    var meta = document.createElement('div');
    meta.className = 'item-meta';
    [formatTime(log.created_at), log.source, log.ip || ''].forEach(function (text) {
      if (!text) return;
      var span = document.createElement('span');
      if (text === log.source) span.className = 'badge';
      span.textContent = text;
      meta.appendChild(span);
    });
    item.appendChild(meta);

    var detail = describeChange(log);
    if (detail) {
      var pre = document.createElement('pre');
      pre.className = 'log-diff';
      pre.textContent = detail;
      item.appendChild(pre);
    }

    list.appendChild(item);
  });
}

/** 変更前後を読みやすい1〜2行にする。 */
function describeChange(log) {
  var before = log.before_json ? JSON.parse(log.before_json) : null;
  var after = log.after_json ? JSON.parse(log.after_json) : null;

  if (log.action === 'notice.create' && after) return after.body;
  if (log.action === 'notice.delete' && before) return before.body;
  if (log.action === 'notice.update' && before && after) {
    if (before.body !== after.body) return before.body + '\n  ↓\n' + after.body;
    return '期限を変更';
  }
  if (log.action === 'settings.update' && before && after) {
    return Object.keys(after).map(function (k) {
      return k + ': ' + JSON.stringify(before[k]) + ' → ' + JSON.stringify(after[k]);
    }).join('\n');
  }
  return '';
}

function loadAuditLogs() {
  var action = document.getElementById('audit-filter').value;
  return api('/audit-logs' + (action ? '?action=' + encodeURIComponent(action) : ''))
    .then(renderAuditLogs)
    .catch(function (e) { toast(e.message, true); });
}

// ---- 起動 ----

function start() {
  setupTabs();
  setupNoticeForm();
  setupSettingsForm();
  document.getElementById('audit-filter').addEventListener('change', loadAuditLogs);

  fetch('/api/me')
    .then(function (res) {
      if (res.status === 401) { location.href = '/auth/login'; return null; }
      return res.json();
    })
    .then(function (me) {
      if (me) document.getElementById('user-name').textContent = me.userName;
    })
    .catch(function () { /* 表示名が出ないだけなので無視 */ });

  loadNotices();
}

start();
