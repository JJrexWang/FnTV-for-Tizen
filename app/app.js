// FnTV v1 — UI: login / home poster rows / detail / AVPlay player.
// Remote-first: geometry-based spatial focus, no pointer assumptions.
'use strict';

function $(id) { return document.getElementById(id); }
function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return h > 0 ? h + ':' + p(m) + ':' + p(s) : m + ':' + p(s);
}
function itemTitle(it) { return it.title || it.tv_title || it.name || '(无标题)'; }
function isPlayable(it) { return it.type === 'Movie' || it.type === 'Video' || it.type === 'Episode'; }
function isFolderish(it) { return it.type === 'Directory' || it.type === 'TV' || it.type === 'Folder' || it.type === 'Season'; }

/* ---------------- log & toast ---------------- */
var logLines = [];
function appLog(msg) {
  if (typeof PREFS !== 'undefined' && PREFS.logEnabled === false) return;
  var t = new Date().toTimeString().slice(0, 8);
  logLines.push('[' + t + '] ' + msg);
  if (logLines.length > 120) logLines.shift();
  var ov = $('log-overlay');
  if (ov.style.display === 'block') ov.textContent = logLines.join('\n');
}
var toastTimer = null;
function toast(msg, ms) {
  var t = $('toast');
  t.textContent = msg;
  t.style.display = 'block';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.style.display = 'none'; }, ms || 5000);
}

/* ---------------- screens ---------------- */
var curScreen = 'login';
var screenFocusMem = {}; // screen name -> element id to refocus
function showScreen(name) {
  var screens = document.querySelectorAll('.screen');
  for (var i = 0; i < screens.length; i++) screens[i].classList.remove('active');
  $('scr-' + name).classList.add('active');
  curScreen = name;
  curFocus = null;
  var mem = screenFocusMem[name];
  var target = mem ? document.getElementById(mem) : null;
  if (!target || !isFocusable(target)) target = firstFocusable(name);
  if (target) setFocus(target);
}
function exitApp() {
  try { tizen.application.getCurrentApplication().exit(); } catch (e) { /* not on TV */ }
}

/* ---------------- focus engine ---------------- */
var curFocus = null;
var editing = false;
var editKeyHandled = false; // keydown path already finished this edit; blur handler must not advance twice
function isFocusable(e) {
  if (!e || !e.classList || !e.classList.contains('foc')) return false;
  var r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
function screenFocusables(name) {
  var root = $('scr-' + name);
  var all = root.querySelectorAll('.foc');
  var out = [];
  for (var i = 0; i < all.length; i++) if (isFocusable(all[i])) out.push(all[i]);
  return out;
}
function firstFocusable(name) {
  var list = screenFocusables(name);
  return list.length ? list[0] : null;
}
function setFocus(e) {
  if (curFocus) curFocus.classList.remove('focused');
  curFocus = e;
  if (e) {
    e.classList.add('focused');
    if (e.id) screenFocusMem[curScreen] = e.id;
    ensureVisible(e);
    if (typeof onFocused === 'function') onFocused(e);
  }
}
function ensureVisible(e) {
  /* Read all rects first, then write all scroll offsets. Interleaving
     reads and writes (the old loop re-read the element rect after every
     scroll write) forces a full reflow per ancestor per keypress. */
  var chain = [];
  var node = e.parentNode;
  while (node && node !== document.body) {
    var v = node.scrollHeight > node.clientHeight + 4;
    var h = node.scrollWidth > node.clientWidth + 4;
    if (v || h) chain.push({ n: node, r: node.getBoundingClientRect(), v: v, h: h });
    node = node.parentNode;
  }
  if (!chain.length) return;
  var r = e.getBoundingClientRect();
  var titleEl = null;
  var blk = e.closest ? e.closest('.row-block') : null;
  if (blk) titleEl = blk.querySelector('.row-title');
  else if (e.classList.contains('ep-card')) {
    var rw = e.parentNode, pv = rw ? rw.previousElementSibling : null;
    if (pv && pv.classList.contains('sec-title')) titleEl = pv;
  }
  var titleTop = titleEl ? titleEl.getBoundingClientRect().top : null;
  for (var i = 0; i < chain.length; i++) {
    var c = chain[i], nr = c.r;
    if (c.v) {
      if (r.top < nr.top + 16) {
        var target = r.top;
        if (titleTop !== null && titleTop < target) target = titleTop;
        c.n.scrollTop -= (nr.top + 16 - target);
      }
      else if (r.bottom > nr.bottom - 16) c.n.scrollTop += (r.bottom - nr.bottom + 16);
    }
    if (c.h) {
      if (r.left < nr.left + 16) c.n.scrollLeft -= (nr.left + 16 - r.left);
      else if (r.right > nr.right - 16) c.n.scrollLeft += (r.right - nr.right + 16);
    }
  }
}
/* One rect read per element per move: the old flow read every rect twice
   (visibility filter + scoring) and interleaved reads with scroll writes
   in ensureVisible, forcing repeated full reflows on the TV's engine —
   the visible symptom was the focus cursor trailing the remote. */
function focusablesWithRects(name) {
  var root = $('scr-' + name);
  var all = root.querySelectorAll('.foc');
  var out = [];
  for (var i = 0; i < all.length; i++) {
    var r = all[i].getBoundingClientRect();
    if (r.width > 0 && r.height > 0) out.push({ el: all[i], r: r });
  }
  return out;
}
function moveFocus(dir) {
  if (!curFocus) { var f = firstFocusable(curScreen); if (f) setFocus(f); return; }
  var list = focusablesWithRects(curScreen);
  var cr = null;
  for (var i = 0; i < list.length; i++) if (list[i].el === curFocus) { cr = list[i].r; break; }
  if (!cr) cr = curFocus.getBoundingClientRect();
  var cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
  var best = null, bestScore = Infinity;
  for (var j = 0; j < list.length; j++) {
    var c = list[j];
    if (c.el === curFocus) continue;
    var r = c.r;
    var x = r.left + r.width / 2, y = r.top + r.height / 2;
    var dx = x - cx, dy = y - cy;
    var primary, perp;
    if (dir === 'left') { if (dx > -10) continue; primary = -dx; perp = Math.abs(dy); }
    else if (dir === 'right') { if (dx < 10) continue; primary = dx; perp = Math.abs(dy); }
    else if (dir === 'up') { if (dy > -10) continue; primary = -dy; perp = Math.abs(dx); }
    else { if (dy < 10) continue; primary = dy; perp = Math.abs(dx); }
    var score = primary + perp * 2.4;
    if (score < bestScore) { bestScore = score; best = c.el; }
  }
  if (best) setFocus(best);
}
/* Coalesce rapid remote repeats into at most one move per frame, always
   in the latest direction — a backlog of queued moves is what made the
   cursor keep travelling after the user stopped pressing. */
var pendingDir = null, moveRafOn = false;
function queueMove(dir) {
  pendingDir = dir;
  if (moveRafOn) return;
  moveRafOn = true;
  var run = function () {
    moveRafOn = false;
    var d = pendingDir; pendingDir = null;
    if (d) moveFocus(d);
  };
  if (window.requestAnimationFrame) window.requestAnimationFrame(run);
  else setTimeout(run, 16);
}

function toggleLog() {
  var ov = $('log-overlay');
  var show = ov.style.display !== 'block';
  ov.style.display = show ? 'block' : 'none';
  if (show) { ov.textContent = logLines.join('\n'); uploadLog(true); }
}
/* ---------------- log page ---------------- */
var logReturn = 'home';
function openLogPage(from) {
  logReturn = from || curScreen || 'home';
  showScreen('logs');
  renderLogPage();
  setFocus($('btn-log-up'));
}
function renderLogPage() {
  var tg = $('btn-log-toggle');
  if (tg) tg.textContent = '日志记录：' + (PREFS.logEnabled === false ? '关' : '开');
  var hb = $('btn-log-hint');
  if (hb) hb.textContent = '日志提示：' + (PREFS.logHints === false ? '关' : '开');
  var v = $('log-view');
  if (v) {
    v.textContent = logLines.length ? logLines.join('\n') : '（暂无日志）';
    v.scrollTop = v.scrollHeight;
  }
  var foot = $('log-foot');
  if (foot) {
    var last = '';
    try { last = localStorage.getItem('fntv_last_sync') || ''; } catch (e) { /* ignore */ }
    foot.textContent = '当前日志共 ' + logLines.length + ' 行' + (last ? ' · 上次同步：' + last : '');
  }
}
function importLog() {
  if (!FN.proxy || !FN.token) { toast('未登录或未设代理，无法导入'); return; }
  toast('正在从 NAS 导入…');
  fetch(FN.proxy + '/log-file?t=' + encodeURIComponent(FN.token)).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }).then(function (txt) {
    var v = $('log-view');
    v.textContent = txt || '（NAS 上暂无日志）';
    v.scrollTop = v.scrollHeight;
    $('log-foot').textContent = '已导入 NAS 上的日志 · ' + (txt ? txt.split('\n').length : 0) + ' 行（本地日志未改动）';
  }).catch(function (e) { toast('导入失败: ' + e.message); });
}
/* Ship the on-screen log to the NAS proxy, which appends it to
   DockerAPPs/fntv-proxy/logs/fntv-tv.log where it can be read directly. */
/* Persistent last-sync state: shown on the home topbar and the settings
   page, so a missed toast no longer looks like "nothing happened". */
function syncTimeStr() {
  var d = new Date();
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
function setLastSync(text) {
  try { localStorage.setItem('fntv_last_sync', text); } catch (e) { /* ignore */ }
  var h = $('home-sync'); if (h) h.textContent = '上次同步：' + text;
  var s = $('set-sync'); if (s) s.textContent = '上次同步：' + text;
}
function logHintsOn() { return PREFS.logHints !== false; }
function applyLogHints() {
  var d = logHintsOn() ? '' : 'none';
  var h = $('home-sync'); if (h) h.style.display = d;
  var s = $('set-sync'); if (s) s.style.display = d;
}
function uploadLog(silent) {
  if (!FN.proxy || !FN.token) {
    if (!silent && logHintsOn()) toast('未登录或未设代理，无法同步');
    setLastSync('未同步（未登录或未设代理）');
    return;
  }
  var timedOut = false;
  var to = setTimeout(function () {
    timedOut = true;
    if (logHintsOn()) toast('日志同步失败(超时)');
    setLastSync('失败(超时) ' + syncTimeStr());
  }, 8000);
  fetch(FN.proxy + '/log?t=' + encodeURIComponent(FN.token), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: logLines.join('\n') + '\n---IMGRAW---\n' + imgRawLines.join('\n')
  }).then(function (r) {
    if (timedOut) return;
    clearTimeout(to);
    if (logHintsOn()) toast(r.ok ? '日志已同步到 NAS' : '日志同步失败(' + r.status + ')');
    setLastSync((r.ok ? '成功 ' : '失败(' + r.status + ') ') + syncTimeStr());
    if (r.ok) appLog('日志已同步到 NAS');
  }).catch(function (e) {
    if (timedOut) return;
    clearTimeout(to);
    if (logHintsOn()) toast('日志同步失败(网络)');
    setLastSync('失败(网络) ' + syncTimeStr());
  });
}

/* ---------------- global keys ---------------- */
document.addEventListener('keydown', function (ev) {
  var code = ev.keyCode;
  if (code === 48) { // '0' toggles the debug log overlay
    toggleLog();
    ev.preventDefault();
    return;
  }
  if (PL.active) {
    if (PL.uiMode !== 'none') { playerUiKey(code, ev); return; }
    playerKey(code, ev);
    return;
  }
  if (editing) {
    var ae = document.activeElement;
    var aeIsInput = ae && ae.tagName === 'INPUT';
    if (aeIsInput && ae.id === 'in-q' && (code === 13 || code === 10252 || code === 415 || code === 40)) {
      // Search field: Confirm/Down finishes typing and lands on the
      // search button (the IME swallows plain arrows otherwise).
      editKeyHandled = true;
      editing = false;
      ae.blur();
      setFocus($('btn-dosearch'));
      ev.preventDefault();
      return;
    }
    if (aeIsInput && (code === 13 || code === 10252 || code === 415)) {
      // Confirm finishes a form field and advances to the next item
      // (login chain: server -> account -> password -> proxy -> login).
      editKeyHandled = true;
      editing = false;
      ae.blur();
      advanceFromInput(ae);
      ev.preventDefault();
      return;
    }
    if (aeIsInput && (code === 10009 || code === 461)) {
      // Back while the TV keyboard is up: finish editing, stay on the
      // field, and swallow the key so it doesn't also go back a screen.
      editKeyHandled = true;
      editing = false;
      ae.blur();
      ev.preventDefault();
      return;
    }
    if (aeIsInput) return; // IME is driving the input; system handles keys
    editing = false; // stale flag (keyboard closed without a blur): recover
  }
  if (curScreen === 'logs' && curFocus === $('log-view') && (code === 38 || code === 40)) {
    $('log-view').scrollTop += (code === 40 ? 320 : -320);
    ev.preventDefault();
    return;
  }
  if (code === 37) { queueMove('left'); ev.preventDefault(); }
  else if (code === 38) { queueMove('up'); ev.preventDefault(); }
  else if (code === 39) { queueMove('right'); ev.preventDefault(); }
  else if (code === 40) { queueMove('down'); ev.preventDefault(); }
  else if (code === 13) {
    if (curFocus) { activate(curFocus); ev.preventDefault(); }
  } else if (code === 10009 || code === 461) {
    backKey();
    ev.preventDefault();
  }
});
/* After a field is finished, where focus goes: the search field lands
   on the search button; login fields walk the form chain in order. */
var LOGIN_CHAIN = ['in-server', 'in-user', 'in-pass', 'in-proxy', 'btn-login'];
function advanceFromInput(e) {
  if (e.id === 'in-q') { setFocus($('btn-dosearch')); return; }
  var i = LOGIN_CHAIN.indexOf(e.id);
  if (i >= 0 && i < LOGIN_CHAIN.length - 1) setFocus($(LOGIN_CHAIN[i + 1]));
}
function activate(e) {
  if (e.tagName === 'INPUT') {
    if (!editing && document.activeElement === e) {
      // Already DOM-focused with the keyboard closed: Enter means
      // "done with this field" — move on instead of re-entering edit.
      if (e.id === 'in-q') { doSearch(); return; }
      e.blur();
      advanceFromInput(e);
      return;
    }
    editing = true;
    editKeyHandled = false;
    e.focus();
    toast(e.id === 'in-q' ? '输完按【确认】或【↓】跳到「搜索」按钮' : '输完按【确认】到下一项，按【返回】结束输入', 4000);
    var done = function () {
      e.removeEventListener('blur', done);
      e.removeEventListener('focusout', done);
      var byKey = editKeyHandled;
      editKeyHandled = false;
      editing = false;
      if (curFocus === e) e.classList.add('focused');
      if (!byKey) {
        // The TV keyboard closed on its own (its Done key): treat it
        // like Confirm — advance instead of leaving focus in limbo.
        advanceFromInput(e);
      }
    };
    e.addEventListener('blur', done);
    e.addEventListener('focusout', done);
    return;
  }
  if (e.__onenter) e.__onenter();
}
function backKey() {
  if (curScreen === 'detail') { closeDetail(); }
  else if (curScreen === 'logs') { showScreen(logReturn || 'home'); }
  else if (curScreen === 'settings' || curScreen === 'search' || curScreen === 'browse') { showScreen('home'); }
  else if (curScreen === 'home') { exitApp(); }
  else if (curScreen === 'login') { exitApp(); }
}

/* ---------------- login ---------------- */
function loginStatus(msg) { $('login-status').textContent = msg; }
function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise(function (resolve, reject) {
      setTimeout(function () { reject(new Error(label + '超时（' + Math.round(ms / 1000) + ' 秒无响应）')); }, ms);
    })
  ]);
}
function doLogin() {
  loginStatus('登录中…');
  var server = $('in-server').value.trim().replace(/\/+$/, '');
  var user = $('in-user').value.trim();
  var pass = $('in-pass').value;
  var proxy = $('in-proxy').value.trim().replace(/\/+$/, '');
  if (!server || !user || !pass) { loginStatus('服务器/账号/密码都要填'); return; }
  FN.base = server; FN.proxy = proxy;
  appLog('尝试登录: ' + server + ' 账号 ' + user);
  withTimeout(apiSysConfig(), 12000, '连接服务器').then(function (cfg) {
    FN.serverName = cfg.server_name || '';
    return withTimeout(apiLogin(user, pass), 12000, '登录');
  }).then(function () {
    settingsSave(server, user, pass, proxy);
    loginStatus('登录成功');
    appLog('登录成功: ' + FN.serverName + ' @ ' + server);
    loadHome();
  }).catch(function (e) {
    loginStatus('登录失败: ' + e.message);
    appLog('登录失败: ' + e.message);
  });
}

/* ---------------- home ---------------- */
var homeRows = []; // {kind:'continue'|'lib', lib?, items:[], total, page, loading}
function loadHome() {
  showScreen('home');
  setTimeout(function () { uploadLog(true); }, 10000); // auto-ship: unconditional, not gated on the media list
  $('home-server').textContent = FN.serverName ? ('已连接 ' + FN.serverName) : '';
  $('home-empty').style.display = 'block';
  $('home-empty').textContent = '正在加载媒体库…';
  $('home-rows').innerHTML = '';
  homeRows = [];
  apiPlayList().then(function (list) {
    if (list && list.length) {
      list.slice(0, 2).forEach(function (it) { dumpImgRaw(it, 'play'); });
      homeRows.push({ kind: 'continue', items: list });
      renderHomeRow(homeRows[homeRows.length - 1]);
    }
  }).catch(function (e) { appLog('继续观看加载失败: ' + e.message); });
  apiMediaDbList().then(function (libs) {
    $('home-empty').style.display = 'none';
    if (!libs || !libs.length) { $('home-empty').textContent = '没有媒体库'; $('home-empty').style.display = 'block'; return; }
    libs.forEach(function (lib) {
      var row = { kind: 'lib', lib: lib, items: [], total: 0, page: 0, loading: false };
      homeRows.push(row);
      renderHomeRow(row);
      loadLibPage(row);
    });
    var f = document.querySelector('#scr-home .card') || firstFocusable('home');
    if (f) setFocus(f);
  }).catch(function (e) {
    $('home-empty').textContent = '媒体库加载失败: ' + e.message;
    appLog('媒体库加载失败: ' + e.message);
  });
}
var imgRawDumped = 0;
var imgRawLines = []; // persistent copy: logLines is capped at 120 and drops these
function dumpImgRaw(it, where) {
  if (imgRawDumped >= 16 || !it) return;
  imgRawDumped++;
  try {
    var line = 'IMGRAW[' + where + ' ' + itemTitle(it) + '] keys=' + Object.keys(it).join(',') +
      ' poster=' + JSON.stringify(it.poster || '') + ' posters=' + JSON.stringify(it.posters || '') +
      ' backdrops=' + JSON.stringify(it.backdrops || '') + ' still=' + JSON.stringify(it.still_path || '');
    appLog(line);
    imgRawLines.push(line);
    if (imgRawLines.length > 40) imgRawLines.shift();
  } catch (e) { /* ignore */ }
}
function loadLibPage(row) {
  if (row.loading || (row.total && row.items.length >= row.total)) return;
  row.loading = true;
  apiBrowse(row.lib.guid, row.page + 1, 60, row.kind === 'browse' ? browseTags() : null).then(function (d) {
    row.loading = false;
    row.page += 1;
    row.total = (d && d.total) || 0;
    var list = (d && d.list) || [];
    list.slice(0, 3).forEach(function (it) { dumpImgRaw(it, 'list'); });
    list.forEach(function (it) {
      row.items.push(it);
      row.cardsEl.appendChild(buildCard(it, row));
    });
    if (row.countEl) row.countEl.textContent = row.total ? ('共 ' + row.total) : '';
  }).catch(function (e) {
    row.loading = false;
    appLog('库「' + row.lib.title + '」加载失败: ' + e.message);
  });
}
function renderHomeRow(row) {
  var block = el('div', 'row-block');
  var title = el('div', 'row-title', row.kind === 'continue' ? '继续观看' : row.lib.title);
  if (row.kind === 'lib') {
    var cnt = el('span', 'row-count');
    title.appendChild(cnt);
    row.countEl = cnt;
    var allBtn = el('button', 'all-link foc', '查看全部 →');
    allBtn.__onenter = (function (lib) { return function () { openBrowse(lib); }; })(row.lib);
    title.appendChild(allBtn);
  }
  var scroller = el('div', 'row-scroll');
  row.cardsEl = scroller;
  block.appendChild(title);
  block.appendChild(scroller);
  if (row.kind === 'continue' && $('home-rows').firstChild) {
    $('home-rows').insertBefore(block, $('home-rows').firstChild);
  } else {
    $('home-rows').appendChild(block);
  }
  if (row.kind === 'continue') {
    row.items.forEach(function (it) { scroller.appendChild(buildContinueCard(it)); });
  }
}
function stripToken(u) { return String(u || '').replace(/([?&]t=)[^&]+/g, '$1***'); }
var imgFailLogged = 0;
/* Image with a fallback chain: alternate artwork fields, a delayed retry
   (cold thumbnail generation on the NAS often fails the first hit), and
   failure logging (token stripped) for remote diagnosis. */
/* Home renders 100+ posters at once; decoding all of them up front
   starves the UI thread on this TV. Defer each poster's load until it
   nears the viewport (IntersectionObserver with a prefetch margin). */
var lazyIO = null;
function lazyImgSrc(img, src) {
  if (!('IntersectionObserver' in window)) { img.src = src; return; }
  if (!lazyIO) {
    lazyIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && en.target.__lazySrc) {
          en.target.src = en.target.__lazySrc;
          en.target.__lazySrc = null;
          lazyIO.unobserve(en.target);
        }
      });
    }, { rootMargin: '500px' });
  }
  img.__lazySrc = src;
  lazyIO.observe(img);
}
function imgTag(item, w, backdrop) {
  var img = document.createElement('img');
  var cands = imgCandidates(item, w, backdrop);
  img.__cands = cands;
  img.__candIdx = 0;
  img.__retried = false;
  img.onerror = function () {
    if (!img.__retried && img.__candIdx === 0 && cands.length) {
      img.__retried = true;
      var first = cands[0];
      setTimeout(function () { img.src = first; }, 900);
      return;
    }
    img.__candIdx++;
    if (img.__candIdx < cands.length) {
      img.src = cands[img.__candIdx];
    } else {
      img.style.opacity = '0.22';
      if (imgFailLogged < 16) {
        imgFailLogged++;
        appLog('图片失败[' + itemTitle(item || {}) + ']: ' + stripToken(cands[0] || '(无图)'));
      }
    }
  };
  if (cands.length) lazyImgSrc(img, cands[0]);
  else img.style.opacity = '0.22';
  return img;
}
/* Collections/folders often carry no artwork of their own: borrow the
   first child's. Cached per guid so rows don't refetch. */
var borrowCache = {};
function borrowPoster(item, img) {
  if (!item || !item.guid || borrowCache[item.guid] === 'busy') return;
  if (borrowCache[item.guid]) {
    var cached = borrowCache[item.guid];
    if (cached !== 'none') { img.__cands = cached; img.__candIdx = 0; img.__retried = false; img.style.opacity = ''; img.src = cached[0]; }
    return;
  }
  borrowCache[item.guid] = 'busy';
  apiBrowse(item.guid, 1, 6).then(function (d) {
    var list = (d && d.list) || [];
    var cands = [];
    for (var i = 0; i < list.length && !cands.length; i++) cands = imgCandidates(list[i], 288, false);
    borrowCache[item.guid] = cands.length ? cands : 'none';
    if (cands.length && img.__cands && !img.__cands.length) {
      img.__cands = cands; img.__candIdx = 0; img.__retried = false;
      img.style.opacity = '';
      img.src = cands[0];
    }
  }).catch(function () { borrowCache[item.guid] = 'none'; });
}
function buildCard(it, row) {
  var card = el('div', 'card foc');
  card.id = 'card-' + it.guid;
  var img = imgTag(it, 288, false);
  card.appendChild(img);
  if (isFolderish(it) && !imgCandidates(it, 288, false).length) borrowPoster(it, img);
  if (it.type === 'TV') card.appendChild(el('div', 'card-badge', '剧集'));
  else if (it.type === 'Directory') card.appendChild(el('div', 'card-badge', '文件夹'));
  card.appendChild(el('div', 'card-title', itemTitle(it)));
  card.__onenter = function () { openDetail(it); };
  card.__row = row || null;
  card.__item = it;
  return card;
}
function buildContinueCard(it) {
  var card = el('div', 'card wide foc');
  card.id = 'ccard-' + it.guid;
  card.appendChild(imgTag(it, 500, true));
  var name = itemTitle(it);
  if (it.parent_title) name = it.parent_title + (it.episode_number ? ' · 第' + it.episode_number + '集' : '');
  card.appendChild(el('div', 'card-title', name));
  if (it.duration > 0 && it.ts != null) {
    var prog = el('div', 'prog');
    var fill = el('div');
    fill.style.width = Math.min(100, Math.round(it.ts * 100 / it.duration)) + '%';
    prog.appendChild(fill);
    card.appendChild(prog);
    card.appendChild(el('div', 'card-sub', '剩 ' + fmtTime(it.duration - it.ts)));
  }
  card.__onenter = function () { startPlay(it, null); };
  card.__item = it;
  return card;
}
/* Paging: approaching the end of a library row fetches the next page. */
function onFocused(e) {
  if (curScreen === 'detail' && (e.id === 'detail-play' || e.id === 'detail-watched')) {
    // The action row sits at the bottom of a tall head; aligning the
    // button itself to the viewport top leaves the poster/title cut
    // off. Landing on it means "back to the top of the page".
    $('detail-content').scrollTop = 0;
  }
  if (curScreen === 'player') {
    var hint = $('osd-hint');
    if (hint) hint.textContent = (e === $('osd-bar'))
      ? '←/→ 快退/快进 · ↑ 大步快进 · ↓ 播控按钮 · 确认暂停/播放 · 返回退出'
      : '↑ 回到进度条 · ←/→ 选择按钮 · 确认执行 · 返回关闭菜单';
  }
  var row = e.__row;
  if (!row || (row.kind !== 'lib' && row.kind !== 'browse')) return;
  var idx = row.items.indexOf(e.__item);
  if (idx >= 0 && idx >= row.items.length - 4) loadLibPage(row);
}

/* ---------------- detail ---------------- */
var detailStack = [];
var detailCurrent = null;
var D = null; // {item, info, infoItem, seasons, seasonIdx, episodes, children}
function openDetail(item) {
  if (curScreen === 'detail' && detailCurrent) detailStack.push(detailCurrent);
  detailCurrent = item;
  loadDetail(item);
  setTimeout(function () { uploadLog(true); }, 5000); // ship detail/episode IMGRAW dumps
}
function closeDetail() {
  if (detailStack.length) {
    detailCurrent = detailStack.pop();
    loadDetail(detailCurrent);
  } else {
    detailCurrent = null;
    showScreen('home');
  }
}
function loadDetail(item) {
  showScreen('detail');
  $('detail-bg').removeAttribute('src');
  var root = $('detail-content');
  root.innerHTML = '';
  root.appendChild(el('div', 'sec-title', '加载中…'));
  root.scrollTop = 0;
  D = { item: item, info: null, infoItem: item, seasons: [], seasonIdx: 0, episodes: [], children: [] };
  apiPlayInfo(item.guid).then(function (info) {
    D.info = info;
    if (info && info.item && info.item.guid === item.guid) D.infoItem = info.item;
    return loadDetailChildren();
  }).catch(function (e) {
    appLog('详情加载失败(' + itemTitle(item) + '): ' + e.message);
    return loadDetailChildren(); // still try children with bare item data
  }).then(function () { renderDetail(); });
}
function loadDetailChildren() {
  var item = D.item;
  var ii = D.infoItem || {};
  var isSeries = item.type === 'TV' || (ii.number_of_seasons || 0) > 0;
  if (isSeries) {
    return apiSeasonList(item.guid).then(function (seasons) {
      D.seasons = seasons || [];
      var sid = D.seasons.length ? (D.seasons[0].guid || item.guid) : item.guid;
      return apiEpisodeList(sid);
    }).then(function (eps) {
      D.episodes = eps || [];
      if (!D.episodes.length) return apiChildren(item.guid).then(function (c) { D.episodes = c; });
    }).catch(function (e) {
      appLog('剧集列表失败: ' + e.message);
      return apiChildren(item.guid).then(function (c) { D.episodes = c; }).catch(function () {});
    });
  }
  if (item.type === 'Directory' || item.type === 'Folder') {
    return apiBrowse(item.guid, 1, 100).then(function (d) {
      D.children = (d && d.list) || [];
    }).catch(function (e) { appLog('文件夹加载失败: ' + e.message); });
  }
  return Promise.resolve();
}
function pickPlayTarget() {
  if (D.episodes.length) {
    var i, ep;
    for (i = 0; i < D.episodes.length; i++) {
      ep = D.episodes[i];
      if (ep.ts > 5 && ep.duration > 0 && ep.ts < ep.duration - 10) return { item: ep, index: i, resume: true };
    }
    for (i = 0; i < D.episodes.length; i++) {
      ep = D.episodes[i];
      if (!ep.watched && !(ep.duration > 0 && ep.ts >= ep.duration - 10)) return { item: ep, index: i, resume: false };
    }
    return { item: D.episodes[0], index: 0, resume: false };
  }
  if (isPlayable(D.item)) {
    var ts = D.info ? D.info.ts : 0;
    return { item: D.item, index: -1, resume: ts > 5 };
  }
  return null;
}
function renderDetail() {
  var item = D.item, ii = D.infoItem || item;
  var bg = imgUrl(ii, 1280, true);
  if (bg) $('detail-bg').src = bg;
  var root = $('detail-content');
  root.innerHTML = '';

  var head = el('div', 'detail-head');
  var poster = imgTag(ii, 500, false);
  poster.className = 'detail-poster';
  if (isFolderish(item) && !imgCandidates(ii, 500, false).length) borrowPoster(item, poster);
  head.appendChild(poster);
  var info = el('div', 'detail-info');
  info.appendChild(el('div', 'detail-title', itemTitle(ii)));
  var meta = [];
  var date = ii.release_date || ii.air_date || '';
  if (date) meta.push(date.slice(0, 4));
  if (ii.vote_average && parseFloat(ii.vote_average) > 0) meta.push('★ ' + ii.vote_average);
  if (ii.runtime) meta.push(ii.runtime + ' 分钟');
  else if (ii.duration) meta.push(fmtTime(ii.duration));
  if ((ii.number_of_episodes || 0) > 0) meta.push('共 ' + ii.number_of_episodes + ' 集');
  if (item.type === 'TV') meta.push('剧集');
  else if (item.type === 'Movie') meta.push('电影');
  else if (item.type === 'Video') meta.push('视频');
  else if (item.type === 'Directory') meta.push('文件夹');
  var metaEl = el('div', 'detail-meta');
  metaEl.innerHTML = '';
  meta.forEach(function (m, i) {
    if (i) metaEl.appendChild(document.createTextNode(' · '));
    var s = el('span', m.indexOf('★') === 0 ? 'rate' : '', m);
    metaEl.appendChild(s);
  });
  info.appendChild(metaEl);
  if (ii.overview) info.appendChild(el('div', 'detail-overview', ii.overview));

  var btns = el('div', 'detail-btns');
  var target = pickPlayTarget();
  if (target) {
    var pb = el('button', 'foc primary', target.resume ? '▶ 继续播放' : '▶ 播放');
    pb.id = 'detail-play';
    pb.__onenter = function () {
      startPlay(target.item, D.episodes.length ? { list: D.episodes, index: target.index } : null);
    };
    btns.appendChild(pb);
  }
  if (!ii.watched && isPlayable(item)) {
    var wb = el('button', 'foc', '标为已看');
    wb.id = 'detail-watched';
    wb.__onenter = function () {
      apiSetWatched(item.guid).then(function () {
        toast('已标为已看');
        ii.watched = 1;
        wb.style.display = 'none';
        var p = $('detail-play');
        if (p) setFocus(p);
      }).catch(function (e) { toast('操作失败: ' + e.message); });
    };
    btns.appendChild(wb);
  }
  info.appendChild(btns);
  head.appendChild(info);
  root.appendChild(head);

  if (D.seasons.length > 1) {
    root.appendChild(el('div', 'sec-title', '季'));
    var chips = el('div', 'chip-row');
    D.seasons.forEach(function (s, idx) {
      var chip = el('div', 'chip num foc' + (idx === D.seasonIdx ? ' sel' : ''),
        s.title || ('第' + (s.season_number || idx + 1) + '季'));
      chip.__onenter = function () {
        D.seasonIdx = idx;
        apiEpisodeList(s.guid || item.guid).then(function (eps) {
          D.episodes = eps || [];
          renderDetail();
        }).catch(function (e) { toast('加载剧集失败: ' + e.message); });
      };
      chips.appendChild(chip);
    });
    root.appendChild(chips);
  }

  if (D.episodes.length) {
    D.episodes.slice(0, 2).forEach(function (ep) { dumpImgRaw(ep, 'ep'); });
    root.appendChild(el('div', 'sec-title', '剧集'));
    var row = el('div', 'ep-row');
    D.episodes.forEach(function (ep, idx) { row.appendChild(buildEpCard(ep, idx)); });
    root.appendChild(row);
    if (D.episodes.length >= 1) {
      root.appendChild(el('div', 'sec-title', '选集'));
      root.appendChild(buildNumChips(D.episodes, function (ep, idx) {
        return ep.episode_number ? '第' + ep.episode_number + '集' : '第' + (idx + 1) + '集';
      }, function (ep, idx) { startPlay(ep, { list: D.episodes, index: idx }); }));
    }
  }

  if (D.children.length) {
    root.appendChild(el('div', 'sec-title', '内容'));
    var grid = el('div', 'grid-wrap');
    var playables = D.children.filter(isPlayable);
    D.children.forEach(function (child) {
      var card = buildCard(child, null);
      if (isPlayable(child)) {
        card.__onenter = function () {
          startPlay(child, { list: playables, index: playables.indexOf(child) });
        };
      } else {
        card.__onenter = function () { openDetail(child); };
      }
      grid.appendChild(card);
    });
    root.appendChild(grid);
    if (playables.length >= 1) {
      root.appendChild(el('div', 'sec-title', '番号选集'));
      var sorted = playables.slice().sort(function (a, b) {
        var na = numKey(a), nb = numKey(b);
        if (na !== nb) return na - nb;
        return itemTitle(a) < itemTitle(b) ? -1 : 1;
      });
      root.appendChild(buildNumChips(sorted, function (child) {
        return codeLabel(child);
      }, function (child) { startPlay(child, { list: sorted, index: sorted.indexOf(child) }); }));
    }
  }

  if (!D.episodes.length && !D.children.length && isPlayable(item)) {
    root.appendChild(el('div', 'sec-title', '选集'));
    root.appendChild(buildNumChips([item], function (it) {
      return codeLabel(it);
    }, function (it) { startPlay(it, null); }));
  }

  var f = $('detail-play') || firstFocusable('detail');
  if (f) setFocus(f);
}
/* Sort key for numbered selection: episode_number, else the first
   number found in the title (episode numbers, disc codes like 123). */
function numKey(it) {
  if (it.episode_number) return it.episode_number;
  var m = String(itemTitle(it)).match(/\d+/);
  return m ? parseInt(m[0], 10) : 999999;
}
function codeLabel(it) {
  var t = itemTitle(it);
  var m = t.match(/[A-Za-z]{2,}-?\d{2,}/);
  if (m) return m[0].toUpperCase();
  if (it.episode_number) return '第' + it.episode_number + '集';
  var n = t.match(/\d+/);
  return n ? n[0] : t.slice(0, 10);
}
function buildNumChips(items, labelFn, playFn) {
  var wrap = el('div', 'chip-row');
  items.forEach(function (it, idx) {
    var chip = el('div', 'chip num foc', labelFn(it, idx));
    chip.__onenter = (function (item, i) { return function () { playFn(item, i); }; })(it, idx);
    wrap.appendChild(chip);
  });
  return wrap;
}
function buildEpCard(ep, idx) {
  var card = el('div', 'ep-card foc');
  card.id = 'card-' + ep.guid;
  card.appendChild(imgTag(ep, 500, false));
  var label = (ep.episode_number ? '第' + ep.episode_number + '集' : '第' + (idx + 1) + '集');
  if (ep.title && ep.title !== label) label += ' · ' + ep.title;
  card.appendChild(el('div', 'ep-title', label));
  var done = ep.watched || (ep.duration > 0 && ep.ts >= ep.duration - 10);
  if (done) card.appendChild(el('div', 'ep-done', '已看'));
  else if (ep.ts > 5 && ep.duration > 0) {
    var prog = el('div', 'prog');
    var fill = el('div');
    fill.style.width = Math.min(100, Math.round(ep.ts * 100 / ep.duration)) + '%';
    prog.appendChild(fill);
    card.appendChild(prog);
  }
  card.__onenter = function () { startPlay(ep, { list: D.episodes, index: idx }); };
  card.__item = ep;
  return card;
}

/* ---------------- player ---------------- */
var PL = {
  active: false, playing: false, paused: false, completed: false,
  item: null, info: null, ctx: null, url: '', returnScreen: 'home',
  osdInt: null, reportInt: null, osdHideTimer: null, session: 0,
  uiMode: 'none', // none | bar | panel
  lastInteract: 0,
  tracks: [], aspect: null, ratio: 'fit', rate: 1,
  subCues: null, subTimer: null,
  skipOpenApplied: false, lastBarBtn: 'btn-pp', panelKind: ''
};
var RATES = [1, 1.25, 1.5, 2, 0.5];
var RATIO_LABEL = { fit: '适应', fill: '拉伸', zoom: '放大' };
function playerMsg(msg) { $('player-msg').textContent = msg || ''; }
function avplayReset() {
  try {
    if (typeof webapis !== 'undefined' && webapis.avplay) {
      try { webapis.avplay.stop(); } catch (e) { /* ignore */ }
      try { webapis.avplay.close(); } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
  PL.playing = false; PL.paused = false;
}
function parseAspectStr(s) {
  if (!s) return null;
  var m = String(s).match(/(\d{2,4})\s*[x×*:]\s*(\d{2,4})/);
  if (m) return { w: parseInt(m[1], 10), h: parseInt(m[2], 10) };
  return null;
}
function findVideoAspect(obj, depth) {
  if (!obj || depth > 6) return null;
  if (obj.display_aspect_ratio) {
    var a = parseAspectStr(obj.display_aspect_ratio);
    if (a) return a;
  }
  if (obj.width > 0 && obj.height > 0 && obj.codec_type === 'video') {
    return { w: obj.width, h: obj.height };
  }
  var key;
  for (key in obj) {
    var v = obj[key];
    if (v && typeof v === 'object') {
      var r = findVideoAspect(v, depth + 1);
      if (r) return r;
    }
  }
  return null;
}
/* Display mode via the TV's own scaler. setDisplayRect alone is NOT
   enough: AVPlay's default display method (LETTER_BOX) re-fits the video
   inside any rect, which silently neutralised the stretch mode. */
function applyDisplayMode() {
  if (typeof webapis === 'undefined' || !webapis.avplay) return;
  var a = PL.aspect || { w: 16, h: 9 };
  var r = a.w / a.h, x = 0, y = 0, w = 1920, h = 1080;
  if (PL.ratio === 'zoom') {
    if (1920 / 1080 > r) { w = 1920; h = Math.round(1920 / r); } else { h = 1080; w = Math.round(1080 * r); }
    x = Math.round((1920 - w) / 2); y = Math.round((1080 - h) / 2);
  }
  try { webapis.avplay.setDisplayRect(x, y, w, h); } catch (e) { appLog('setDisplayRect 失败: ' + e.message); }
  var method = PL.ratio === 'fill' ? 'PLAYER_DISPLAY_MODE_FULL_SCREEN' : 'PLAYER_DISPLAY_MODE_LETTER_BOX';
  try { webapis.avplay.setDisplayMethod(method); } catch (e) { appLog('setDisplayMethod 失败: ' + e.message); }
  appLog('画面模式: ' + PL.ratio + ' (' + method + ', rect ' + w + 'x' + h + ')');
}
function startPlay(item, ctx) {
  if (!PL.active) PL.returnScreen = curScreen;
  PL.active = true; PL.completed = false; PL.item = item; PL.ctx = ctx || null; PL.info = null;
  PL.uiMode = 'none'; PL.tracks = []; PL.aspect = null;
  PL.subStreams = []; PL.pendingSub = null; PL.activeSubGuid = '';
  PL.seekOverride = null; PL.cookie = ''; PL.defaultEmbIdx = -1;
  PL.lastInteract = Date.now();
  PL.ratio = PREFS.ratio; PL.rate = 1;
  PL.skipOpenApplied = false;
  var session = ++PL.session;
  if ((!PL.ctx || !PL.ctx.list || PL.ctx.list.length < 2) && item.type === 'Episode' && item.parent_guid) {
    apiEpisodeList(item.parent_guid).then(function (eps) {
      if (session !== PL.session || !PL.active || !eps || !eps.length) return;
      if (PL.ctx && PL.ctx.list && PL.ctx.list.length >= 2) return;
      var nidx = -1;
      eps.forEach(function (e, i) { if (e.guid === item.guid) nidx = i; });
      if (nidx >= 0) { PL.ctx = { list: eps, index: nidx }; refreshBarButtons(); }
    }).catch(function () { /* 上下集按钮保持隐藏 */ });
  }
  showScreen('player');
  $('ppanel').style.display = 'none';
  $('osd').style.display = 'none';
  playerMsg('加载中…');
  appLog('播放: ' + itemTitle(item));
  apiPlayInfo(item.guid).then(function (info) {
    if (session !== PL.session || !PL.active) throw new Error('已取消');
    PL.info = info;
    return Promise.all([
      apiStream(info.media_guid),
      apiStreamList(info.media_guid).catch(function () { return null; }),
      apiStreamList(item.guid).catch(function () { return null; })
    ]);
  }).then(function (r) {
    if (session !== PL.session || !PL.active) return;
    var sd = r[0];
    var subs = [];
    [r[1], r[2]].forEach(function (sl) {
      if (!subs.length && sl && sl.subtitle_streams && sl.subtitle_streams.length) subs = sl.subtitle_streams;
    });
    PL.subStreams = subs;
    PL.pendingSub = null; PL.defaultEmbIdx = -1;
    var defSub = pickDefaultSub(subs, PL.info);
    if (defSub) {
      PL.pendingSub = defSub;
    }
    if (subs.length) {
      appLog('字幕流 ' + subs.length + ' 条: ' + subs.map(function (s) {
        return (s.title || s.guid) + '/' + (s.format || '?') + (s.is_external ? '/外挂' : '/内嵌');
      }).join(' | ') + (defSub ? '；默认: ' + (defSub.title || defSub.guid) : ''));
    } else {
      appLog('字幕流: 无');
    }
    PL.aspect = findVideoAspect(r[1], 0) || findVideoAspect(r[2], 0) ||
      (sd && sd.qualities && sd.qualities[0] ? parseAspectStr(sd.qualities[0].resolution) : null) ||
      { w: 16, h: 9 };
    var direct = sd && sd.direct_link_qualities && sd.direct_link_qualities[0] && sd.direct_link_qualities[0].url;
    var cookie = (sd && sd.header && sd.header.Cookie) ? sd.header.Cookie.join('; ') : '';
    PL.url = playUrl(PL.info.media_guid, direct || '');
    avplayStart(PL.url, cookie);
  }).catch(function (e) {
    if (session !== PL.session || !PL.active) return; // user backed out meanwhile
    appLog('播放准备失败: ' + e.message);
    toast('播放失败: ' + e.message);
    exitPlayer(true);
  });
}
function avplayStart(url, cookie) {
  if (typeof webapis === 'undefined' || !webapis.avplay) {
    toast('此设备不支持 AVPlay');
    exitPlayer(true);
    return;
  }
  avplayReset();
  clearPlayerTimers();
  PL.cookie = cookie || '';
  var session = PL.session;
  try {
    webapis.avplay.open(url);
    if (cookie) {
      try { webapis.avplay.setStreamingProperty('COOKIE', cookie); } catch (e) { /* ignore */ }
    }
    var proceed = function () {
    webapis.avplay.setDisplayRect(0, 0, 1920, 1080);
    webapis.avplay.setListener({
      onbufferingstart: function () { playerMsg('缓冲中…'); },
      onbufferingcomplete: function () { playerMsg(''); },
      onstreamcompleted: function () { onPlayCompleted(); },
      onerror: function (e) {
        appLog('AVPlay 播放错误: ' + e);
        playerMsg('播放出错');
      },
      ondrmevent: function () {}
    });
    webapis.avplay.prepareAsync(function () {
      PL.playing = true; PL.paused = false;
      playerMsg('');
      applyDisplayMode();
      try { PL.tracks = webapis.avplay.getTotalTrackInfo() || []; } catch (e) { PL.tracks = []; }
      var dur = 0;
      try { dur = webapis.avplay.getDuration() / 1000; } catch (e) { /* ignore */ }
      var resume = (PL.seekOverride != null) ? PL.seekOverride :
        ((PREFS.resume && PL.info) ? (PL.info.ts || 0) : 0);
      PL.seekOverride = null;
      var cfg = (PL.info && PL.info.play_config) || {};
      if (resume > 5 && dur > 0 && resume < dur - 15) {
        try { webapis.avplay.seekTo(Math.floor(resume * 1000)); } catch (e) { /* ignore */ }
        playerMsg('从 ' + fmtTime(resume) + ' 继续播放');
        setTimeout(function () { playerMsg(''); }, 3000);
        PL.skipOpenApplied = true;
      } else if (cfg.skip_opening > 0 && dur > cfg.skip_opening + 30) {
        try { webapis.avplay.seekTo(Math.floor(cfg.skip_opening * 1000)); } catch (e) { /* ignore */ }
        playerMsg('已跳过片头');
        setTimeout(function () { playerMsg(''); }, 2500);
        PL.skipOpenApplied = true;
      }
      webapis.avplay.play();
      appLog('字幕 轨道清单: ' + (PL.tracks || []).map(function (t) { return t.type + ':' + t.index; }).join(','));
      tryApplyEmbeddedSub(session);
      if (PL.defaultEmbIdx >= 0) {
        setTimeout(function () { tryApplyEmbeddedSub(session); }, 1200);
        setTimeout(function () { tryApplyEmbeddedSub(session); }, 3000);
      }
      startPlayerTimers();
      // Controls stay hidden on entry; any key press summons them.
    }, function (e) {
      appLog('AVPlay prepare 失败: ' + (e && e.message ? e.message : e));
      toast('播放失败（格式不受支持或网络错误）');
      exitPlayer(true);
    });
    };
    /* Subtitles are painted by the app itself in a DOM overlay (see
       fetchSubCues): AVPlay's own rendering never produced a visible
       subtitle on this TV across three attempts — external SRT file
       downloaded, path accepted, prepare OK, still nothing; embedded
       ASS selectable but not renderable. Embedded streams whose text
       the server will not serve fall back to native track selection. */
    var sub = PL.pendingSub;
    PL.pendingSub = null;
    PL.subCues = null;
    stopSubTimer();
    if (sub && FN.proxy) {
      playerMsg('加载字幕…');
      fetchSubCues(sub.guid, function (cues) {
        if (!PL.active || session !== PL.session) return;
        if (cues) {
          PL.subCues = cues;
          PL.activeSubGuid = sub.guid;
          startSubTimer();
          appLog('字幕 覆盖层启用: ' + (sub.title || sub.guid));
        } else if (!sub.is_external) {
          PL.defaultEmbIdx = embeddedOrdinal(PL.subStreams, sub);
          appLog('字幕 回退内嵌轨选择: ord=' + PL.defaultEmbIdx);
        } else {
          appLog('字幕 外挂文本不可用: ' + (sub.title || sub.guid));
        }
        playerMsg('');
        proceed();
      });
    } else {
      proceed();
    }
  } catch (e) {
    appLog('AVPlay 异常: ' + e.message);
    exitPlayer(true);
  }
}
function curSec() {
  try { return webapis.avplay.getCurrentTime() / 1000; } catch (e) { return 0; }
}
function durSec() {
  try { return webapis.avplay.getDuration() / 1000; } catch (e) { return 0; }
}
function reportPlay(finished) {
  if (!PL.info || !PL.item) return;
  var dur = durSec();
  var ts = curSec();
  if (finished) ts = dur;
  if (dur <= 0) return;
  var st = {
    item_guid: PL.item.guid,
    media_guid: PL.info.media_guid,
    video_guid: PL.info.video_guid || '',
    audio_guid: PL.info.audio_guid || '',
    subtitle_guid: PL.activeSubGuid || PL.info.subtitle_guid || '',
    play_link: PL.url,
    ts: Math.floor(ts),
    duration: Math.floor(dur)
  };
  apiRecordPlay(st).catch(function (e) { appLog('进度回传失败: ' + e.message); });
}
function startPlayerTimers() {
  PL.osdInt = setInterval(updateOSD, 500);
  PL.reportInt = setInterval(function () { reportPlay(false); }, 15000);
}
function clearPlayerTimers() {
  if (PL.osdInt) clearInterval(PL.osdInt);
  if (PL.reportInt) clearInterval(PL.reportInt);
  PL.osdInt = PL.reportInt = null;
}
function showOSD() {
  var osd = $('osd');
  osd.style.display = 'block';
  updateOSD();
  if (PL.osdHideTimer) clearTimeout(PL.osdHideTimer);
  if (PL.uiMode === 'none') {
    setFocus($('osd-bar'));
    PL.osdHideTimer = setTimeout(function () { osd.style.display = 'none'; clearPlayerFocus(); }, (PREFS.osdSec || 5) * 1000);
  }
}
function updateOSD() {
  if (!PL.active) return;
  // Idle auto-close: control bar / panels / OSD hide after PREFS.osdSec
  // seconds without a key press (checked here, runs every 500ms).
  if ((PL.uiMode !== 'none' || $('osd').style.display === 'block') &&
      PL.lastInteract && Date.now() - PL.lastInteract > (PREFS.osdSec || 5) * 1000) {
    if (PL.uiMode === 'panel') { $('ppanel').style.display = 'none'; }
    PL.uiMode = 'none';
    $('osd').style.display = 'none';
    clearPlayerFocus();
  }
  var it = PL.item;
  var name = itemTitle(it);
  if (it && it.parent_title) name = it.parent_title + ' · ' + name;
  $('osd-title').textContent = name || '';
  var cur = curSec(), dur = durSec();
  $('osd-cur').textContent = fmtTime(cur);
  $('osd-dur').textContent = fmtTime(dur);
  $('osd-state').textContent = PL.paused ? '❚❚ 已暂停' : '';
  $('osd-fill').style.width = dur > 0 ? Math.min(100, cur * 100 / dur) + '%' : '0%';
  var pp = $('btn-pp');
  if (pp) pp.textContent = PL.paused ? '▶ 播放' : '❚❚ 暂停';
  // Skip-ending: jump to the next episode when the configured tail is reached.
  var cfg = (PL.info && PL.info.play_config) || {};
  if (!PL.completed && cfg.skip_ending > 0 && PL.ctx && PL.ctx.index >= 0 &&
      PL.ctx.index < PL.ctx.list.length - 1 && dur > 0 && cur > 30 && dur - cur <= cfg.skip_ending) {
    onPlayCompleted();
  }
}
function seekBy(deltaSec) {
  var dur = durSec();
  if (dur <= 0) return;
  var target = Math.min(Math.max(curSec() + deltaSec, 0), dur - 2);
  try { webapis.avplay.seekTo(Math.floor(target * 1000)); } catch (e) { /* ignore */ }
  showOSD();
}
function togglePause() {
  try {
    if (PL.paused) { webapis.avplay.play(); PL.paused = false; }
    else { webapis.avplay.pause(); PL.paused = true; reportPlay(false); }
  } catch (e) { /* ignore */ }
  showOSD();
}
function onPlayCompleted() {
  if (PL.completed) return;
  PL.completed = true;
  reportPlay(true);
  var ctx = PL.ctx;
  if (PREFS.autoNext && ctx && ctx.list && ctx.index >= 0 && ctx.index < ctx.list.length - 1) {
    var next = ctx.list[ctx.index + 1];
    toast('下一集');
    startPlay(next, { list: ctx.list, index: ctx.index + 1 });
  } else {
    exitPlayer(true);
  }
}
function exitPlayer(skipReport) {
  PL.session++;
  if (!skipReport && !PL.completed) reportPlay(false);
  clearPlayerTimers();
  stopSubTimer();
  PL.subCues = null;
  if (PL.osdHideTimer) clearTimeout(PL.osdHideTimer);
  PL.uiMode = 'none';
  $('osd').style.display = 'none';
  $('ppanel').style.display = 'none';
  playerMsg('');
  avplayReset();
  PL.active = false;
  var back = PL.returnScreen || 'home';
  if (back === 'detail' && !detailCurrent) back = 'home';
  showScreen(back);
}
/* ---------- player control bar & panels ---------- */
function refreshBarButtons() {
  var hasPrev = !!(PL.ctx && PL.ctx.index > 0);
  var hasNext = !!(PL.ctx && PL.ctx.index >= 0 && PL.ctx.index < PL.ctx.list.length - 1);
  $('btn-prev').style.display = hasPrev ? '' : 'none';
  $('btn-next').style.display = hasNext ? '' : 'none';
  $('btn-ratio').textContent = '画面：' + RATIO_LABEL[PL.ratio];
  $('btn-pp').textContent = PL.paused ? '▶ 播放' : '❚❚ 暂停';
}
function clearPlayerFocus() {
  if (curFocus && $('scr-player').contains(curFocus)) setFocus(null);
}
function openBar() {
  PL.uiMode = 'bar';
  refreshBarButtons();
  var osd = $('osd');
  osd.style.display = 'block';
  if (PL.osdHideTimer) clearTimeout(PL.osdHideTimer);
  updateOSD();
  setFocus($('osd-bar'));
}
function closeBar() {
  PL.uiMode = 'none';
  $('osd').style.display = 'none';
  clearPlayerFocus();
}
function closePanel() {
  $('ppanel').style.display = 'none';
  PL.uiMode = 'bar';
  refreshBarButtons();
  $('osd').style.display = 'block';
  var t = $(PL.lastBarBtn);
  if (t && isFocusable(t)) setFocus(t);
}
function panelRow(label, action) {
  var row = el('div', 'prow foc', label);
  if (action) row.__onenter = action;
  return row;
}
function openPanel(kind) {
  PL.panelKind = kind;
  PL.uiMode = 'panel';
  $('osd').style.display = 'none';
  var panel = $('ppanel');
  var list = $('ppanel-list');
  list.innerHTML = '';
  panel.style.display = 'block';
  if (kind === 'eps') {
    $('ppanel-title').textContent = '选集';
    buildEpisodePanel(list); // focuses the current episode itself
    return;
  }
  $('ppanel-title').textContent = kind === 'TEXT' ? '字幕' : '音轨';
  buildTrackPanel(list, kind);
  var f = list.querySelector('.foc');
  if (f) setFocus(f);
}
function buildEpisodePanel(list) {
  function fill(ctx) {
    list.innerHTML = '';
    if (!ctx || !ctx.list || !ctx.list.length) {
      var noneRow = panelRow('（无选集信息）', null);
      list.appendChild(noneRow);
      setFocus(noneRow);
      return;
    }
    var curRow = null;
    ctx.list.forEach(function (ep, idx) {
      var label = (ep.episode_number ? '第' + ep.episode_number + '集' : '第' + (idx + 1) + '集') + ' · ' + itemTitle(ep);
      var row = panelRow(label, function () {
        startPlay(ep, { list: ctx.list, index: idx });
      });
      if (PL.item && ep.guid === PL.item.guid) { label += '（播放中）'; row.textContent = label; curRow = row; }
      list.appendChild(row);
    });
    var f = curRow || list.querySelector('.foc');
    if (f) setFocus(f);
  }
  if (PL.ctx && PL.ctx.list) { fill(PL.ctx); return; }
  var loadingRow = panelRow('加载中…', null);
  list.appendChild(loadingRow);
  setFocus(loadingRow);
  var it = PL.item;
  if (it && it.type === 'Episode' && it.parent_guid) {
    apiEpisodeList(it.parent_guid).then(function (eps) {
      if (eps && eps.length) {
        var idx = -1;
        eps.forEach(function (e, i) { if (e.guid === it.guid) idx = i; });
        if (idx >= 0) { PL.ctx = { list: eps, index: idx }; fill(PL.ctx); return; }
      }
      fill(null);
    }).catch(function () { fill(null); });
  } else {
    fill(null);
  }
}
function trackLabel(t) {
  var extra = '';
  try {
    var j = JSON.parse(t.extra_info || '{}');
    extra = j.language || j.title || j.name || '';
  } catch (e) { extra = ''; }
  return (t.type === 'TEXT' ? '字幕 ' : '音轨 ') + (t.index + 1) + (extra ? ' · ' + extra : '');
}
/* fnOS subtitle streams (from stream/list): external ones are separate
   files served by /subtitle/dl/<guid>; embedded ones live in the media
   container and map to AVPlay TEXT tracks by order. */
/* Default subtitle policy, driven by what AVPlay can actually render:
   every chosen stream is downloaded through the proxy (which converts
   ASS/VTT to SRT) and set as an external subtitle file, so external
   streams win outright. Embedded streams are only a fallback — and an
   embedded ASS/SSA/PGS track is the worst pick of all: it can be
   selected via setSelectTrack yet the TV renders nothing for it (this
   was the "recognized but never displayed" bug: the server default was
   an embedded ASS). Chinese-language titles win within a tier. */
function pickDefaultSub(subs, info) {
  if (!subs || !subs.length) return null;
  var best = null, bestScore = Infinity;
  subs.forEach(function (s) {
    var fmt = (s.format || '').toLowerCase();
    var title = (s.title || '').toLowerCase();
    var score;
    if (s.is_external) score = 0;
    else if (fmt.indexOf('srt') >= 0 || fmt.indexOf('subrip') >= 0 || fmt.indexOf('text') >= 0) score = 20;
    else score = 30;
    if (/chs|chi|zho|中文|简|繁/.test(title)) score -= 5;
    if (info && info.subtitle_guid && s.guid === info.subtitle_guid) score -= 2;
    if (s.is_default) score -= 1;
    if (score < bestScore) { bestScore = score; best = s; }
  });
  return best;
}
function embeddedOrdinal(subs, target) {
  var n = 0;
  for (var i = 0; i < subs.length; i++) {
    if (subs[i] === target) return n;
    if (!subs[i].is_external) n++;
  }
  return n;
}
/* Embedded subtitle tracks of a streamed file may only show up in
   getTotalTrackInfo some time after prepare, so the default embedded
   selection is retried rather than applied once. PL.defaultEmbIdx holds
   the pending ordinal among TEXT tracks until it lands. */
function tryApplyEmbeddedSub(session) {
  if (!PL.active || session !== PL.session || PL.defaultEmbIdx < 0) return;
  var ord = PL.defaultEmbIdx;
  try { PL.tracks = webapis.avplay.getTotalTrackInfo() || []; } catch (e) { /* keep old */ }
  var tt = (PL.tracks || []).filter(function (t) { return t.type === 'TEXT'; });
  if (tt.length > ord) {
    try {
      webapis.avplay.setSelectTrack('TEXT', tt[ord].index);
      appLog('字幕 内嵌默认已选: ord=' + ord + ' track=' + tt[ord].index + ' textTracks=' + tt.length);
      PL.defaultEmbIdx = -1;
    } catch (e) { appLog('字幕 内嵌默认选择失败: ' + e.message); }
  } else {
    appLog('字幕 内嵌默认待轨: ord=' + ord + ' textTracks=' + tt.length);
  }
}
function refreshTracks() {
  try { PL.tracks = webapis.avplay.getTotalTrackInfo() || []; } catch (e) { /* keep old */ }
  return PL.tracks || [];
}
/* ---- App-rendered subtitles (DOM overlay above the video plane) ---- */
function parseSrt(text) {
  var cues = [];
  var re = /(\d+):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d+):(\d{2}):(\d{2})[.,](\d{1,3})/;
  function ts(h, mi, s, ms) { return (+h) * 3600 + (+mi) * 60 + (+s) + (+((ms + '00').slice(0, 3))) / 1000; }
  String(text || '').replace(/\r\n/g, '\n').replace(/^\uFEFF/, '').split(/\n\s*\n/).forEach(function (b) {
    var m = b.match(re);
    if (!m) return;
    var lines = b.split('\n');
    var ti = -1;
    for (var i = 0; i < lines.length; i++) if (lines[i].indexOf('-->') >= 0) { ti = i; break; }
    if (ti < 0) return;
    var txt = lines.slice(ti + 1).join('\n').replace(/<[^>]+>/g, '').trim();
    if (txt) cues.push({ start: ts(m[1], m[2], m[3], m[4]), end: ts(m[5], m[6], m[7], m[8]), text: txt });
  });
  cues.sort(function (a, b) { return a.start - b.start; });
  return cues;
}
function fetchSubCues(guid, cb) {
  var done = false;
  function finish(c) { if (!done) { done = true; cb(c); } }
  if (!FN.proxy) { finish(null); return; }
  var url = FN.proxy + '/sub/' + guid + '.srt?t=' + encodeURIComponent(FN.token);
  var to = setTimeout(function () { appLog('字幕 文本拉取超时'); finish(null); }, 15000);
  fetch(url).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }).then(function (text) {
    clearTimeout(to);
    var cues = parseSrt(text);
    appLog('字幕 文本就绪: ' + cues.length + ' 条');
    finish(cues.length ? cues : null);
  }).catch(function (e) {
    clearTimeout(to);
    appLog('字幕 文本拉取失败: ' + e.message);
    finish(null);
  });
}
function subOverlayTick() {
  var ov = $('sub-overlay');
  if (!ov) return;
  if (!PL.active || !PL.subCues) { if (ov.style.display !== 'none') ov.style.display = 'none'; return; }
  var t = curSec();
  var cues = PL.subCues, txt = '';
  for (var i = 0; i < cues.length; i++) {
    if (cues[i].start > t) break;
    if (t <= cues[i].end) { txt = cues[i].text; break; }
  }
  if (txt) {
    if (ov.textContent !== txt) ov.textContent = txt;
    if (ov.style.display !== 'block') ov.style.display = 'block';
  } else if (ov.style.display !== 'none') ov.style.display = 'none';
}
function startSubTimer() {
  stopSubTimer();
  PL.subTimer = setInterval(subOverlayTick, 250);
}
function stopSubTimer() {
  if (PL.subTimer) { clearInterval(PL.subTimer); PL.subTimer = null; }
  var ov = $('sub-overlay');
  if (ov) ov.style.display = 'none';
}
/* Download a subtitle (as SRT, via the proxy) to the TV's private tmp
   storage; AVPlay can only use external subtitles from a local path.
   (No longer used since the overlay renderer landed in v1.2.4.) */
function downloadSubToTV(guid, cb) {
  var done = false;
  function finish(p) { if (!done) { done = true; cb(p); } }
  if (typeof tizen === 'undefined' || !tizen.download) { appLog('无 Download API'); finish(null); return; }
  var url = FN.proxy + '/sub/' + guid + '.srt?t=' + encodeURIComponent(FN.token);
  try {
    var req = new tizen.DownloadRequest(url, 'wgt-private-tmp', 'fntv_sub_' + PL.session + '.srt');
    tizen.download.start(req, {
      oncompleted: function (dlId, fullPath) { appLog('字幕下载完成: ' + fullPath); finish(fullPath); },
      onfailed: function (e) { appLog('字幕下载失败: ' + (e && e.message ? e.message : e)); finish(null); }
    });
    setTimeout(function () { if (!done) appLog('字幕下载超时(20s)'); finish(null); }, 20000);
  } catch (e) {
    appLog('字幕下载异常: ' + e.message);
    finish(null);
  }
}
/* Switching an external subtitle mid-playback means restarting AVPlay
   (the path must be set before prepare); resume at the same position. */
function restartPlaybackWithSub(stream) {
  var pos = curSec();
  PL.pendingSub = stream || null;
  PL.activeSubGuid = stream ? stream.guid : '';
  PL.seekOverride = pos > 2 ? Math.floor(pos) : 0;
  PL.defaultEmbIdx = -1;
  toast(stream ? '加载字幕…' : '字幕已关闭');
  appLog('重载播放器切换字幕: ' + (stream ? (stream.title || stream.guid) : '关闭') + ' @' + Math.floor(pos) + 's');
  avplayStart(PL.url, PL.cookie);
}
function buildSubPanel(list) {
  list.appendChild(panelRow('关闭字幕', function () {
    closePanel();
    if (PL.activeSubGuid) {
      restartPlaybackWithSub(null);
    } else {
      try { webapis.avplay.setSelectTrack('TEXT', -1); toast('字幕已关闭'); }
      catch (e) { toast('关闭字幕失败: ' + e.message); appLog('setSelectTrack TEXT -1 失败: ' + e.message); }
    }
  }));
  PL.subStreams.forEach(function (s) {
    var label = (s.title || '字幕') + ' · ' + (s.format || '') + (s.is_external ? ' · 外挂' : ' · 内嵌') +
      (PL.activeSubGuid === s.guid ? '（使用中）' : '');
    list.appendChild(panelRow(label, function () {
      closePanel();
      if (PL.activeSubGuid === s.guid) { toast('已是当前字幕'); return; }
      /* Every stream goes through the SRT download path (embedded ASS in
         particular can be selected but never rendered by AVPlay); if the
         download fails, avplayStart falls back to track selection. */
      restartPlaybackWithSub(s);
    }));
  });
}
function buildTrackPanel(list, type) {
  if (type === 'TEXT' && PL.subStreams && PL.subStreams.length) { buildSubPanel(list); return; }
  var tracks = refreshTracks().filter(function (t) { return t.type === type; });
  if (!tracks.length) {
    list.appendChild(panelRow(type === 'TEXT' ? '（无可用字幕轨）' : '（无可用音轨）', null));
    return;
  }
  if (type === 'TEXT') {
    list.appendChild(panelRow('关闭字幕', function () {
      try { webapis.avplay.setSelectTrack('TEXT', -1); toast('字幕已关闭'); }
      catch (e) { toast('关闭字幕失败: ' + e.message); appLog('setSelectTrack TEXT -1 失败: ' + e.message); }
      closePanel();
    }));
  }
  tracks.forEach(function (t) {
    list.appendChild(panelRow(trackLabel(t), function () {
      try {
        webapis.avplay.setSelectTrack(type, t.index);
        toast('已切换' + (type === 'TEXT' ? '字幕' : '音轨'));
      } catch (e) {
        toast('切换失败: ' + e.message);
        appLog('setSelectTrack 失败: ' + e.message);
      }
      closePanel();
    }));
  });
}
function playNeighbor(delta) {
  var ctx = PL.ctx;
  if (!ctx || !ctx.list) return;
  var idx = ctx.index + delta;
  if (idx < 0 || idx >= ctx.list.length) return;
  startPlay(ctx.list[idx], { list: ctx.list, index: idx });
}
function playerKey(code, ev) {
  ev.preventDefault();
  PL.lastInteract = Date.now();
  if (code === 10009 || code === 461) { exitPlayer(false); return; }
  if (!PL.playing) return;
  if (code === 40) { openBar(); return; }
  var step = PREFS.seekStep || 30;
  if (code === 37 || code === 412) seekBy(-step);
  else if (code === 39 || code === 417) seekBy(step);
  else if (code === 38) seekBy(step * 10);
  else if (code === 13 || code === 10252 || code === 415 || code === 19) togglePause();
  else if (code === 413) exitPlayer(false);
  else showOSD();
}
function playerUiKey(code, ev) {
  ev.preventDefault();
  PL.lastInteract = Date.now();
  if (PL.uiMode === 'bar' && curFocus === $('osd-bar')) {
    var step = PREFS.seekStep || 30;
    if (code === 37 || code === 412) seekBy(-step);
    else if (code === 39 || code === 417) seekBy(step);
    else if (code === 38) seekBy(step * 10);
    else if (code === 40) setFocus($('btn-pp'));
    else if (code === 13 || code === 10252 || code === 415 || code === 19) { togglePause(); refreshBarButtons(); }
    else if (code === 10009 || code === 461) closeBar();
    return;
  }
  if (code === 37) queueMove('left');
  else if (code === 38) {
    if (PL.uiMode === 'bar') setFocus($('osd-bar'));
    else queueMove('up');
  }
  else if (code === 39) queueMove('right');
  else if (code === 40) queueMove('down');
  else if (code === 13) { if (curFocus) activate(curFocus); }
  else if (code === 10009 || code === 461) {
    if (PL.uiMode === 'panel') closePanel();
    else closeBar();
  }
}
function wirePlayerButtons() {
  $('btn-prev').__onenter = function () { playNeighbor(-1); };
  $('btn-next').__onenter = function () { playNeighbor(1); };
  $('btn-pp').__onenter = function () { togglePause(); refreshBarButtons(); };
  $('btn-eps').__onenter = function () { PL.lastBarBtn = 'btn-eps'; openPanel('eps'); };
  $('btn-sub').__onenter = function () { PL.lastBarBtn = 'btn-sub'; openPanel('TEXT'); };
  $('btn-aud').__onenter = function () { PL.lastBarBtn = 'btn-aud'; openPanel('AUDIO'); };
  $('btn-ratio').__onenter = function () {
    PL.ratio = PL.ratio === 'fit' ? 'fill' : (PL.ratio === 'fill' ? 'zoom' : 'fit');
    applyDisplayMode();
    refreshBarButtons();
    setFocus($('btn-ratio'));
  };
}

/* ---------------- browse / search / settings ---------------- */
var browseRow = null;
function openBrowse(lib) {
  showScreen('browse');
  $('browse-title').textContent = lib.title;
  $('browse-grid').innerHTML = '';
  BF = bfDefaults();
  BF_OPTS = null;
  closeFilters();
  browseRow = {
    kind: 'browse', lib: lib, items: [], total: 0, page: 0, loading: false,
    cardsEl: $('browse-grid'), countEl: $('browse-count')
  };
  loadLibPage(browseRow);
  apiTagList(lib.guid).then(function (d) {
    BF_OPTS = d || {};
    buildFilterPanel();
  }).catch(function (e) {
    BF_OPTS = {};
    buildFilterPanel();
    appLog('筛选选项加载失败: ' + e.message);
  });
}
/* ---------------- browse filters (mirrors the web client's panel) ----
   Options come from GET /tag/list for the open library; the chosen
   values go back verbatim as extra tags on POST /item/list. Genre
   values are TMDB ids, localized locally. One value per dimension. */
var BF = null;
var BF_OPTS = null;
var GENRE_ZH = { 1: '动作', 2: '冒险', 3: '动画', 4: '喜剧', 5: '犯罪', 6: '纪录', 7: '剧情', 8: '家庭', 9: '科幻奇幻', 10: '历史', 11: '恐怖', 12: '音乐', 13: '悬疑', 14: '爱情', 16: '电视电影', 17: '惊悚', 18: '战争政治', 19: '西部', 30: '动作冒险', 31: '儿童', 32: '新闻', 33: '真人秀', 35: '肥皂剧', 36: '脱口秀', 101: '体育', 102: '财经', 103: '教育', 104: '生活', 105: '本地', 106: '其他', 109: '电视剧', 110: '综艺', 111: '儿童' };
var LOCATE_ZH = { US: '美国', CN: '中国大陆', HK: '中国香港', TW: '中国台湾', JP: '日本', KR: '韩国', GB: '英国', FR: '法国', DE: '德国', AT: '奥地利', MX: '墨西哥', CA: '加拿大', AU: '澳大利亚', IN: '印度', IT: '意大利', ES: '西班牙', RU: '俄罗斯' };
function bfDefaults() {
  return { type: '', genres: -1, resolution: '', color_range: '', audio_type: '', locate: '', decade: '', recognition_status: '', watched: '' };
}
var BF_DIMS = [
  { key: 'type', label: '影视分类', fixed: [['', '全部'], ['Movie', '电影'], ['TV', '电视节目']] },
  { key: 'genres', label: '类型', src: 'genres' },
  { key: 'resolution', label: '分辨率', src: 'resolutions' },
  { key: 'color_range', label: '动态范围', src: 'color_range' },
  { key: 'audio_type', label: '音频规格', src: 'audio_type' },
  { key: 'locate', label: '国家/地区', src: 'locate' },
  { key: 'decade', label: '发行年份', src: 'decades' },
  { key: 'recognition_status', label: '匹配状态', src: 'recognition_status' },
  { key: 'watched', label: '是否已观看', fixed: [['', '全部'], ['1', '已观看'], ['0', '未观看']] }
];
function bfLabel(dim, v) {
  if (dim === 'genres') return GENRE_ZH[v] || ('类型 ' + v);
  if (dim === 'decade') {
    if (v === 'Recent') return '今年';
    var m = /^(\d{4})s$/.exec(String(v));
    return m ? m[1] + '年代' : String(v);
  }
  if (dim === 'recognition_status') return ({ '0': '未匹配', '1': '已匹配', '2': '读取 NFO' })[String(v)] || ('状态 ' + v);
  if (dim === 'locate') return LOCATE_ZH[v] || String(v);
  if (dim === 'audio_type') return ({ atmos: '杜比全景声', stereo: '立体声', other: '其他' })[String(v).toLowerCase()] || String(v);
  return String(v);
}
function browseTags() {
  if (!BF) return null;
  var t = {};
  if (BF.type) t.type = [BF.type];
  if (BF.genres !== -1 && BF.genres !== '' && BF.genres != null) t.genres = BF.genres;
  ['resolution', 'color_range', 'audio_type', 'locate', 'decade', 'recognition_status', 'watched'].forEach(function (k) {
    if (BF[k] !== '' && BF[k] != null) t[k] = BF[k];
  });
  return Object.keys(t).length ? t : null;
}
function buildFilterPanel() {
  var host = $('browse-filter-rows');
  if (!host) return;
  host.innerHTML = '';
  BF_DIMS.forEach(function (dim) {
    var opts = null;
    if (dim.fixed) opts = dim.fixed;
    else if (BF_OPTS && BF_OPTS[dim.src] && BF_OPTS[dim.src].length) {
      opts = [[dim.key === 'genres' ? -1 : '', '全部']];
      BF_OPTS[dim.src].forEach(function (v) { opts.push([v, bfLabel(dim.key, v)]); });
    }
    if (!opts) return;
    var rowEl = el('div', 'flt-row');
    rowEl.appendChild(el('span', 'flt-label', dim.label));
    var chips = el('div', 'flt-chips');
    opts.forEach(function (pair) {
      var b = el('button', 'foc chip flt-chip', pair[1]);
      if (String(BF[dim.key]) === String(pair[0])) b.classList.add('sel');
      b.__onenter = (function (d, v, btn) {
        return function () { setFilter(d, v, btn); };
      })(dim.key, pair[0], b);
      chips.appendChild(b);
    });
    rowEl.appendChild(chips);
    host.appendChild(rowEl);
  });
  sizeBrowseScroll();
}
function setFilter(dim, v, btn) {
  BF[dim] = v;
  var chips = btn.parentNode;
  var bs = chips.querySelectorAll('.flt-chip');
  for (var i = 0; i < bs.length; i++) bs[i].classList.remove('sel');
  btn.classList.add('sel');
  reloadBrowse();
}
function reloadBrowse() {
  if (!browseRow) return;
  browseRow.items = [];
  browseRow.page = 0;
  browseRow.total = 0;
  browseRow.cardsEl.innerHTML = '';
  loadLibPage(browseRow);
}
function sizeBrowseScroll() {
  var sc = $('browse-scroll');
  if (!sc) return;
  if ($('scr-browse').classList.contains('filters-open')) {
    var panel = $('browse-filters');
    sc.style.height = Math.max(280, 988 - (panel ? panel.offsetHeight : 0) - 6) + 'px';
  } else {
    sc.style.height = '988px';
  }
}
function openFilters() {
  $('scr-browse').classList.add('filters-open');
  $('browse-filters').style.display = 'block';
  sizeBrowseScroll();
}
function closeFilters() {
  $('scr-browse').classList.remove('filters-open');
  var p = $('browse-filters');
  if (p) p.style.display = 'none';
  sizeBrowseScroll();
}
function doSearch() {
  var q = $('in-q').value.trim();
  var box = $('search-results');
  if (!q) { $('search-status').textContent = '先输入关键词'; return; }
  $('search-status').textContent = '搜索中…';
  box.innerHTML = '';
  apiSearch(q).then(function (list) {
    list = list || [];
    $('search-status').textContent = '找到 ' + list.length + ' 条';
    list.forEach(function (it) { box.appendChild(buildCard(it, null)); });
    var f = box.querySelector('.foc');
    if (f) setFocus(f);
  }).catch(function (e) {
    $('search-status').textContent = '搜索失败: ' + e.message;
    appLog('搜索失败: ' + e.message);
  });
}
/* ---------------- search on-screen letter keyboard ----------------
   The fnOS server matches pinyin initials (verified on the user's own
   library: "lldq" finds the title), so a remote-driven letter board can
   drive the regular search API without the TV system keyboard. The
   system keyboard stays available as the other mode (Chinese text,
   1-2 character titles the server cannot match by initials). */
var KB_ROWS = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
function buildKeyboard() {
  var kb = $('kb');
  if (!kb || kb.childNodes.length) return;
  KB_ROWS.forEach(function (rowStr) {
    var row = document.createElement('div');
    row.className = 'kb-row';
    for (var i = 0; i < rowStr.length; i++) {
      (function (ch) {
        var b = document.createElement('button');
        b.className = 'foc kb-key';
        b.id = 'kb-' + ch;
        b.textContent = ch;
        b.__onenter = function () { kbType(ch); };
        row.appendChild(b);
      })(rowStr.charAt(i));
    }
    kb.appendChild(row);
  });
  var last = document.createElement('div');
  last.className = 'kb-row';
  [['kb-del', '⌫ 退格', function () { kbBackspace(); }],
   ['kb-space', '空格', function () { kbType(' '); }],
   ['kb-clear', '清空', function () { setQuery(''); }],
   ['kb-go', '搜索', function () { doSearch(); }]].forEach(function (spec) {
    var b = document.createElement('button');
    b.className = 'foc kb-key kb-wide';
    b.id = spec[0];
    b.textContent = spec[1];
    b.__onenter = spec[2];
    last.appendChild(b);
  });
  kb.appendChild(last);
}
function setQuery(v) { $('in-q').value = v; syncQDisplay(); }
function kbType(ch) { setQuery(($('in-q').value || '') + ch); }
function kbBackspace() {
  var v = $('in-q').value || '';
  if (v) setQuery(v.slice(0, -1));
}
function syncQDisplay() {
  var v = $('in-q').value || '';
  $('q-text').textContent = v;
  $('q-ph').style.display = v ? 'none' : 'inline';
}
function searchKbOn() { return PREFS.searchKb !== false; }
function applySearchMode() {
  var kbOn = searchKbOn();
  $('kb').style.display = kbOn ? 'block' : 'none';
  $('q-display').style.display = kbOn ? 'inline-block' : 'none';
  $('in-q').style.display = kbOn ? 'none' : '';
  $('btn-kbmode').textContent = kbOn ? '中文输入' : '字母键盘';
  $('search-hint').textContent = kbOn
    ? '方向键选字母、按确认输入（可输首字母，如 LLDQ）；输完按「搜索」'
    : '输入完按【确认】或【↓】，跳到「搜索」按钮，再按【确认】开始搜索';
  $('search-scroll').style.height = kbOn ? '380px' : '816px';
  syncQDisplay();
}
function openSearch() {
  showScreen('search');
  applySearchMode();
  if (searchKbOn()) { var a = $('kb-A'); if (a) setFocus(a); }
  else setFocus($('in-q'));
}

function refreshSettings() {
  $('set-account').textContent = (FN.user || '') + ' @ ' + (FN.base || '');
  $('set-proxy').textContent = '播放/图片代理：' + (FN.proxy || '未设置');
  $('btn-set-ratio').textContent = '默认画面模式：' + RATIO_LABEL[PREFS.ratio];
  $('btn-set-autonext').textContent = '完播自动连播下一集：' + (PREFS.autoNext ? '开' : '关');
  $('btn-set-resume').textContent = '断点续播：' + (PREFS.resume ? '开' : '关');
  $('btn-set-seek').textContent = '快进/快退步长：' + PREFS.seekStep + ' 秒';
  $('btn-set-osd').textContent = '播控界面自动隐藏：' + PREFS.osdSec + ' 秒';
  $('btn-set-scale').textContent = '焦点放大比例：' + Math.round((PREFS.focusScale || 1.16) * 100) + '%';
  $('btn-set-tz').textContent = '时钟时区：' + tzLabel();
}
function tzLabel() {
  if (typeof PREFS.tzOffset !== 'number') return '自动（跟随电视）';
  var o = PREFS.tzOffset, a = Math.abs(o);
  return 'UTC' + (o < 0 ? '−' : '+') + Math.floor(a / 60) + (a % 60 ? ':' + ('0' + (a % 60)).slice(-2) : '');
}
function applyFocusScale() {
  try { document.documentElement.style.setProperty('--fscale', String(PREFS.focusScale || 1.16)); } catch (e) { /* ignore */ }
}
function openSettings() {
  refreshSettings();
  showScreen('settings');
}
function wireSettings() {
  $('btn-set-ratio').__onenter = function () {
    PREFS.ratio = PREFS.ratio === 'fit' ? 'fill' : (PREFS.ratio === 'fill' ? 'zoom' : 'fit');
    prefsSave(); refreshSettings();
  };
  $('btn-set-autonext').__onenter = function () { PREFS.autoNext = !PREFS.autoNext; prefsSave(); refreshSettings(); };
  $('btn-set-resume').__onenter = function () { PREFS.resume = !PREFS.resume; prefsSave(); refreshSettings(); };
  $('btn-set-seek').__onenter = function () {
    PREFS.seekStep = PREFS.seekStep === 10 ? 30 : (PREFS.seekStep === 30 ? 60 : 10);
    prefsSave(); refreshSettings();
  };
  $('btn-set-osd').__onenter = function () {
    PREFS.osdSec = PREFS.osdSec === 3 ? 5 : (PREFS.osdSec === 5 ? 10 : 3);
    prefsSave(); refreshSettings();
  };
  $('btn-set-scale').__onenter = function () {
    var steps = [1.06, 1.12, 1.16, 1.22];
    var i = steps.indexOf(PREFS.focusScale);
    PREFS.focusScale = steps[(i + 1) % steps.length];
    prefsSave(); applyFocusScale(); refreshSettings();
  };
  $('btn-set-tz').__onenter = function () {
    var opts = [null, 480, 540, 420, 360, 300, 180, 0, -300, -480];
    var cur = typeof PREFS.tzOffset === 'number' ? PREFS.tzOffset : null;
    PREFS.tzOffset = opts[(opts.indexOf(cur) + 1) % opts.length];
    prefsSave(); refreshSettings();
    if (window.tickFnTvClock) window.tickFnTvClock();
    toast('时钟时区：' + tzLabel());
  };
  $('btn-set-logout').__onenter = function () {
    FN.token = '';
    showScreen('login');
    loginStatus('已退出登录');
    setFocus($('btn-login'));
  };
  $('btn-set-wipe').__onenter = function () {
    settingsClear();
    toast('已清除本机保存的账号密码');
  };
  $('btn-set-back').__onenter = function () { showScreen('home'); };
}

/* ---------------- boot ---------------- */
window.addEventListener('load', function () {
  try {
    ['MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop', 'MediaFastForward', 'MediaRewind'].forEach(function (k) {
      try { tizen.tvinputdevice.registerKey(k); } catch (e) { /* ignore */ }
    });
  } catch (e) { /* not on TV */ }

  prefsLoad(); applyFocusScale(); applyLogHints(); buildKeyboard(); applySearchMode();
  wirePlayerButtons();
  wireSettings();
  $('btn-home-search').__onenter = function () { openSearch(); };
  $('btn-kbmode').__onenter = function () {
    PREFS.searchKb = !searchKbOn();
    prefsSave();
    applySearchMode();
    if (searchKbOn()) { var ka = $('kb-A'); if (ka) setFocus(ka); }
    else setFocus($('in-q'));
  };
  $('btn-home-settings').__onenter = openSettings;
  $('btn-home-log').__onenter = function () { openLogPage('home'); };
  $('btn-set-log').__onenter = function () { openLogPage('settings'); };
  $('btn-log-up').__onenter = function () { uploadLog(false); setTimeout(renderLogPage, 400); };
  $('btn-log-down').__onenter = importLog;
  $('btn-log-toggle').__onenter = function () {
    PREFS.logEnabled = PREFS.logEnabled === false ? true : false;
    prefsSave();
    if (PREFS.logEnabled) appLog('日志记录已开启');
    renderLogPage();
    toast('日志记录已' + (PREFS.logEnabled ? '开启' : '关闭'));
  };
  $('btn-log-hint').__onenter = function () {
    PREFS.logHints = PREFS.logHints === false ? true : false;
    prefsSave();
    applyLogHints();
    renderLogPage();
    toast('日志提示已' + (PREFS.logHints ? '开启' : '关闭'));
  };
  $('btn-log-clear').__onenter = function () { logLines = []; renderLogPage(); toast('日志已清空'); };
  $('btn-log-back').__onenter = function () { showScreen(logReturn || 'home'); };
  $('btn-dosearch').__onenter = doSearch;
  $('btn-browse-filter').__onenter = function () {
    if ($('scr-browse').classList.contains('filters-open')) closeFilters();
    else openFilters();
  };
  $('btn-browse-reset').__onenter = function () {
    BF = bfDefaults();
    buildFilterPanel();
    reloadBrowse();
  };

  var foc = document.querySelectorAll('#scr-login input, #scr-login button');
  for (var i = 0; i < foc.length; i++) foc[i].classList.add('foc');
  $('btn-login').classList.add('primary');
  $('btn-login').__onenter = doLogin;
  $('btn-clear').__onenter = function () {
    settingsClear();
    $('in-pass').value = '';
    loginStatus('已清除保存的登录信息');
  };
  $('btn-login-log').__onenter = function () { openLogPage('login'); };

  var s = settingsLoad();
  try { setLastSync(localStorage.getItem('fntv_last_sync') || '未同步'); } catch (e) { setLastSync('未同步'); }
  if (s.server) $('in-server').value = s.server;
  if (s.user) $('in-user').value = s.user;
  if (s.pass) $('in-pass').value = s.pass;
  if (s.proxy) $('in-proxy').value = s.proxy;

  showScreen('login');
  if (s.user && s.pass && s.server) {
    setFocus($('btn-login'));
    loginStatus('自动登录中…');
    doLogin();
  } else {
    setFocus(s.user ? $('btn-login') : $('in-user'));
  }

  function tickClock() {
    var c = $('home-clock');
    if (!c) return;
    function p(n) { return (n < 10 ? '0' : '') + n; }
    var wk = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    var y, mo, da, wd, hh, mi;
    if (typeof PREFS.tzOffset === 'number') {
      // Manual zone from Settings: shift the UTC clock by the offset.
      var du = new Date(Date.now() + PREFS.tzOffset * 60000);
      y = du.getUTCFullYear(); mo = du.getUTCMonth() + 1; da = du.getUTCDate();
      wd = du.getUTCDay(); hh = du.getUTCHours(); mi = du.getUTCMinutes();
    } else {
      try {
        // The JS engine's timezone can differ from the TV's own setting;
        // tizen.time reads the system clock/timezone directly.
        var tz = tizen.time.getCurrentDateTime();
        y = tz.getFullYear(); mo = tz.getMonth() + 1; da = tz.getDate();
        wd = tz.getDay(); hh = tz.getHours(); mi = tz.getMinutes();
      } catch (e) {
        var d = new Date();
        y = d.getFullYear(); mo = d.getMonth() + 1; da = d.getDate();
        wd = d.getDay(); hh = d.getHours(); mi = d.getMinutes();
      }
    }
    c.textContent = y + '年' + mo + '月' + da + '日 ' + wk[wd] + ' ' + p(hh) + ':' + p(mi);
  }
  window.tickFnTvClock = tickClock;
  tickClock();
  setInterval(tickClock, 20000);
});
