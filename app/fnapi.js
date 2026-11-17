// FnTV — fnOS media API layer.
// Signing scheme + endpoint shapes ported from the open-source
// fntv-electron project (QiaoKes) and cross-checked against the
// fnos_tv_danmu Android client; verified live against the user's NAS.
'use strict';

/* fnOS web-client signing constants (built into the public web client).
   Local self-use only; never leave the device. */
var API_KEY = 'NDzZTVxnRKP8Z0jXg1VAMonaG8akvh';
var API_SECRET = '16CCEB3D-AB42-077D-36A1-F355324E4237';

var FN = {
  base: '',        // e.g. http://192.168.1.10:5666
  proxy: '',       // e.g. http://192.168.1.10:18090
  token: '',
  user: '',
  serverName: ''
};

function fnLog(msg) {
  if (typeof appLog === 'function') appLog(msg);
  if (typeof console !== 'undefined') console.log(msg);
}

function fnNonce() { return String(Math.floor(Math.random() * 900000) + 100000); }

function genAuthx(url, data) {
  var n = fnNonce();
  var ts = String(Date.now());
  var dataJson = typeof data === 'string' ? data : (data ? JSON.stringify(data) : '');
  var sign = md5([API_KEY, url, n, ts, md5(dataJson), API_SECRET].join('_'));
  return 'nonce=' + n + '&timestamp=' + ts + '&sign=' + sign;
}

/* One signed request. Resolves with the parsed `data` field;
   rejects with an Error carrying the server message on code !== 0.
   signPath overrides the string fed to the signature (defaults to path);
   used by GET-with-query endpoints where the server may sign either form. */
function fnRequest(method, path, data, signPath) {
  var bodyObj = null;
  if (method === 'POST' || method === 'PUT') {
    bodyObj = data || {};
    bodyObj.nonce = fnNonce(); // server expects a nonce field in POST bodies
  }
  var headers = {
    'Content-Type': 'application/json',
    'Authorization': FN.token || '',
    'Authx': genAuthx(signPath || path, bodyObj !== null ? bodyObj : data)
  };
  var opts = { method: method, headers: headers };
  if (bodyObj) opts.body = JSON.stringify(bodyObj);
  return fetch(FN.base + path, opts).then(function (res) {
    return res.text().then(function (text) {
      var json = null;
      try { json = JSON.parse(text); } catch (e) { /* keep null */ }
      if (!json) throw new Error('HTTP ' + res.status + ' 非 JSON 响应: ' + text.slice(0, 120));
      if (json.code !== 0) {
        var err = new Error('接口 ' + path + ' 返回 code=' + json.code + ' ' + (json.msg || ''));
        err.code = json.code;
        throw err;
      }
      return json.data;
    });
  });
}

/* ---------------- endpoints ---------------- */

function apiSysConfig() { return fnRequest('GET', '/v/api/v1/sys/config'); }

function apiLogin(user, pass) {
  return fnRequest('POST', '/v/api/v1/login', {
    username: user, password: pass, app_name: 'trimemedia-web'
  }).then(function (data) {
    FN.token = data.token;
    FN.user = user;
    return data;
  });
}

function apiMediaDbList() { return fnRequest('GET', '/v/api/v1/mediadb/list'); }

/* Browse a library or folder (all content types). Resolves {total, list}. */
function apiBrowse(ancestorGuid, page, pageSize) {
  return fnRequest('POST', '/v/api/v1/item/list', {
    ancestor_guid: ancestorGuid,
    tags: { type: ['Movie', 'TV', 'Directory', 'Video'] },
    exclude_grouped_video: 1,
    sort_type: 'DESC', sort_column: 'create_time',
    page_size: pageSize || 60, page: page || 1
  });
}

/* Children of a series/folder: playable items sorted by episode number. */
function apiChildren(ancestorGuid) {
  return fnRequest('POST', '/v/api/v1/item/list', {
    ancestor_guid: ancestorGuid,
    tags: { type: ['Episode', 'Movie', 'Video'] },
    exclude_grouped_video: 1,
    sort_type: 'ASC', sort_column: 'episode_number',
    page_size: 200, page: 1
  }).then(function (d) { return (d && d.list) || []; });
}

function apiPlayList() { return fnRequest('GET', '/v/api/v1/play/list'); }
function apiPlayInfo(itemGuid) { return fnRequest('POST', '/v/api/v1/play/info', { item_guid: itemGuid }); }
function apiSeasonList(id) { return fnRequest('GET', '/v/api/v1/season/list/' + id); }
function apiEpisodeList(id) { return fnRequest('GET', '/v/api/v1/episode/list/' + id); }

function apiStream(mediaGuid) {
  return fnRequest('POST', '/v/api/v1/stream', {
    header: { 'User-Agent': ['trim_player'] },
    level: 1, media_guid: mediaGuid, ip: uuidFromString(FN.user || '')
  });
}

function apiRecordPlay(st) { return fnRequest('POST', '/v/api/v1/play/record', st); }
function apiSetWatched(itemGuid) { return fnRequest('POST', '/v/api/v1/item/watched', { item_guid: itemGuid }); }
function apiStreamList(mediaGuid) { return fnRequest('GET', '/v/api/v1/stream/list/' + mediaGuid); }

/* Search. Signing rule for GET-with-query (per the official web client,
   verified live 2026-11-17): sign the bare path, with the DECODED query
   string in the data-MD5 slot. Signing the percent-encoded form passes
   for ASCII keywords but fails with code=5000 (invalid sign) for
   Chinese keywords and spaces. */
function apiSearch(q) {
  var query = 'q=' + encodeURIComponent(q);
  return fnRequest('GET', '/v/api/v1/search/list?' + query, 'q=' + q, '/v/api/v1/search/list');
}

/* ---------------- playback preferences (TV-local) ---------------- */
var PREFS = { ratio: 'fit', autoNext: true, resume: true, seekStep: 30, osdSec: 5, focusScale: 1.16, logEnabled: true, logHints: true, tzOffset: null };
function prefsLoad() {
  try {
    var raw = localStorage.getItem('fntv_prefs');
    if (raw) {
      var p = JSON.parse(raw);
      for (var k in PREFS) if (p[k] !== undefined) PREFS[k] = p[k];
    }
  } catch (e) { /* ignore */ }
  return PREFS;
}
function prefsSave() {
  try { localStorage.setItem('fntv_prefs', JSON.stringify(PREFS)); } catch (e) { /* ignore */ }
}

/* ---------------- URL builders ---------------- */

function firstImgPath(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (v instanceof Array) {
    for (var i = 0; i < v.length; i++) if (v[i]) return String(v[i]);
  }
  return '';
}

function itemImgPath(item, preferBackdrop) {
  if (!item) return '';
  var p = '';
  if (preferBackdrop) p = firstImgPath(item.backdrops) || firstImgPath(item.posters) || item.poster || '';
  else p = item.poster || firstImgPath(item.posters) || firstImgPath(item.backdrops) || '';
  return p || '';
}

/* One image path -> loadable URL. Local fnOS paths and remote http(s)
   artwork both go through the NAS proxy (it adds auth headers for local
   paths and fetches remote artwork server-side). */
function pathToUrl(path, w) {
  if (!path) return '';
  if (path.indexOf('http://') === 0 || path.indexOf('https://') === 0) {
    if (FN.proxy) return FN.proxy + '/img?p=' + encodeURIComponent(path) + '&t=' + encodeURIComponent(FN.token);
    return path;
  }
  var full;
  if (path.indexOf('/v/') === 0) full = path;
  else if (path.charAt(0) === '/') full = '/v/api/v1/sys/img' + path;
  else full = '/v/api/v1/sys/img/' + path;
  full += (full.indexOf('?') >= 0 ? '&' : '?') + 'w=' + (w || 400);
  if (FN.proxy) return FN.proxy + '/img?p=' + encodeURIComponent(full) + '&t=' + encodeURIComponent(FN.token);
  return FN.base + full;
}

/* Ordered candidate URLs for an item's artwork: preferred field first,
   then the other field; remote URLs also get a direct-load attempt. */
function imgCandidates(item, w, preferBackdrop) {
  var first = preferBackdrop ? firstImgPath(item && item.backdrops) : (item && item.poster);
  var second = preferBackdrop ? (item && item.poster) : firstImgPath(item && item.backdrops);
  var third = preferBackdrop ? firstImgPath(item && item.posters) : firstImgPath(item && item.posters);
  var fourth = item && item.still_path;
  var paths = [];
  [first, second, third, fourth].forEach(function (p) {
    p = firstImgPath(p) || (typeof p === 'string' ? p : '');
    if (p && paths.indexOf(p) < 0) paths.push(p);
  });
  var urls = [];
  paths.forEach(function (p) {
    var u = pathToUrl(p, w);
    if (u && urls.indexOf(u) < 0) urls.push(u);
    if ((p.indexOf('http://') === 0 || p.indexOf('https://') === 0) && urls.indexOf(p) < 0) urls.push(p);
  });
  return urls;
}

/* Single best artwork URL (backgrounds, detail poster). */
function imgUrl(item, w, preferBackdrop) {
  var c = imgCandidates(item, w, preferBackdrop);
  return c.length ? c[0] : '';
}

function playUrl(mediaGuid, directUrl) {
  if (directUrl) return directUrl;
  if (FN.proxy) return FN.proxy + '/play/' + mediaGuid + '?t=' + encodeURIComponent(FN.token);
  return FN.base + '/v/api/v1/media/range/' + mediaGuid;
}

/* ---------------- saved settings (TV-local) ---------------- */

function settingsSave(server, user, pass, proxy) {
  try {
    localStorage.setItem('fntv_server', server);
    localStorage.setItem('fntv_user', user);
    localStorage.setItem('fntv_pass', pass);
    localStorage.setItem('fntv_proxy', proxy);
  } catch (e) { fnLog('保存设置失败: ' + e.message); }
}
function settingsLoad() {
  try {
    return {
      server: localStorage.getItem('fntv_server') || '',
      user: localStorage.getItem('fntv_user') || '',
      pass: localStorage.getItem('fntv_pass') || '',
      proxy: localStorage.getItem('fntv_proxy') || ''
    };
  } catch (e) { return { server: '', user: '', pass: '', proxy: '' }; }
}
function settingsClear() {
  try {
    localStorage.removeItem('fntv_server');
    localStorage.removeItem('fntv_user');
    localStorage.removeItem('fntv_pass');
    localStorage.removeItem('fntv_proxy');
  } catch (e) { /* ignore */ }
}
