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
function apiBrowse(ancestorGuid, page, pageSize, extraTags) {
  var tags = { type: ['Movie', 'TV', 'Directory', 'Video'] };
  if (extraTags) { for (var k in extraTags) tags[k] = extraTags[k]; }
  return fnRequest('POST', '/v/api/v1/item/list', {
    ancestor_guid: ancestorGuid,
    tags: tags,
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
/* Filter options present in one library (genre ids, resolutions,
   color ranges, audio types, countries, decades, match states).
   Values are passed back verbatim as item/list tags. */
function apiTagList(ancestorGuid) {
  var data = 'ancestor_guid=' + ancestorGuid + '&is_favorite=0';
  return fnRequest('GET', '/v/api/v1/tag/list?' + data, data, '/v/api/v1/tag/list');
}

function apiSearch(q) {
  var query = 'q=' + encodeURIComponent(q);
  return fnRequest('GET', '/v/api/v1/search/list?' + query, 'q=' + q, '/v/api/v1/search/list');
}

/* ---------------- playback preferences (TV-local) ---------------- */
var PREFS = { ratio: 'fit', autoNext: true, resume: true, seekStep: 30, osdSec: 5, focusScale: 1.16, logEnabled: true, logHints: true, tzOffset: null, searchKb: true , lang: 'zh' };
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

/* ---------------- i18n (zh / en) ----------------
   UI language lives in PREFS.lang ('zh' default). t() reads the active
   dictionary; static markup carries data-i18n keys applied by
   applyI18n() in app.js. Switching language restarts the app so every
   screen re-renders in the new language. */
var I18N = {
  zh: {
    appSubtitle: '飞牛影视 · 电视客户端', server: '服务器', account: '飞牛账号', password: '密码',
    proxy: '播放代理', login: '登录', clearSaved: '清除保存', logs: '日志',
    loginHint: '操作：选中输入框按【确认】打开键盘输入；输完再按【确认】自动到下一项；【返回】结束输入',
    inputNextHint: '输完按【确认】到下一项，按【返回】结束输入',
    search: '搜索', settings: '设置', loading: '正在加载…', filter: '筛选', reset: '重置',
    filterHint: '点选条件即时生效；再按顶栏「筛选」收起',
    kbPlaceholder: '输入片名首字母，如 LLDQ', kbChinese: '中文输入', kbLetters: '字母键盘',
    searchHintKb: '方向键选字母、按确认输入（可输首字母，如 LLDQ）；输完按「搜索」',
    searchHintText: '输入完按【确认】或【↓】，跳到「搜索」按钮，再按【确认】开始搜索',
    accountLabel: '账号：', logMgmt: '日志管理', logout: '退出登录（回登录页）',
    wipe: '清除保存的账号密码', back: '← 返回', prefsLocal: '偏好保存在电视本机',
    exportNas: '导出到 NAS', importNas: '从 NAS 导入', clearLog: '清空日志',
    prevEp: '⏮ 上一集', nextEp: '下一集 ⏭', episodes: '选集', subtitlesBtn: '字幕', audioBtn: '音轨',
    playerHint: '←/→ 快退/快进 · ↑ 大步快进 · ↓ 播控按钮 · 确认暂停/播放 · 返回退出',
    on: '开', off: '关', yes: '是', no: '否',
    continueWatching: '继续观看', viewAll: '查看全部 →', connected: '已连接 ',
    loadingLibs: '正在加载媒体库…', noLibs: '没有媒体库',
    libsFail: '媒体库加载失败: ', continueFail: '继续观看加载失败: ',
    loginBusy: '登录中…', autoLoginBusy: '自动登录中…', loginOk: '登录成功',
    loginFail: '登录失败: ', loginNeed: '服务器/账号/密码都要填',
    loggedOut: '已退出登录', wiped: '已清除本机保存的账号密码',
    searchFirst: '先输入关键词', searching: '搜索中…', searchFail: '搜索失败: ',
    setProxy: '播放/图片代理：', notSet: '未设置', setRatio: '默认画面模式：',
    setAutoNext: '完播自动连播下一集：', setResume: '断点续播：',
    setSeek: '快进/快退步长：', seconds: ' 秒', setOsd: '播控界面自动隐藏：',
    setScale: '焦点放大比例：', setTz: '时钟时区：', tzAuto: '自动（跟随电视）',
    setLang: '语言：', langSwitched: '语言已切换，正在重启…',
    lastSync: '上次同步：', notSynced: '未同步',
    logRec: '日志记录：', logHintT: '日志提示：', noLogs: '（暂无日志）',
    importNeed: '未登录或未设代理，无法导入', importing: '正在从 NAS 导入…',
    logCleared: '日志已清空',
    play: '▶ 播放', resumePlay: '▶ 继续播放', markWatched: '标为已看',
    markedWatched: '已标为已看', opFail: '操作失败: ', epsFail: '加载剧集失败: ',
    seasonWord: '季', watchedBadge: '已看', typeVideo: '视频', typeFolder: '文件夹',
    loading2: '加载中…', loadingSub: '加载字幕…', paused: '❚❚ 已暂停', pauseBtn: '❚❚ 暂停',
    playBtn: '▶ 播放', aspectPrefix: '画面：', playingNow: '（播放中）',
    dimType: '影视分类', dimGenres: '类型', dimResolution: '分辨率', dimColor: '动态范围',
    dimAudio: '音频规格', dimLocate: '国家/地区', dimDecade: '发行年份',
    dimRecognition: '匹配状态', dimWatched: '是否已观看',
    all: '全部', movie: '电影', tv: '电视节目', watchedYes: '已观看', watchedNo: '未观看',
    thisYear: '今年', rec0: '未匹配', rec1: '已匹配', rec2: '读取 NFO',
    atmos: '杜比全景声', stereo: '立体声', other: '其他',
    buffering: '缓冲中…', playError: '播放出错', resumeFromA: '从 ', resumeFromB: ' 继续播放',
    introSkipped: '已跳过片头', subOff: '字幕已关闭', importFail: '导入失败: ',
    logSynced: '日志已同步到 NAS', logSyncTimeout: '日志同步失败(超时)', logSyncNet: '日志同步失败(网络)', logSyncFailA: '日志同步失败(',
    untitled: '(无标题)', toastNext: '下一集', noEpInfo: '（无选集信息）',
    switchedTo: '已切换', switchFail: '切换失败: ',
    genreFallback: '类型 ', statusFallback: '状态 '
  },
  en: {
    appSubtitle: 'fnOS Media · TV Client', server: 'Server', account: 'fnOS account', password: 'Password',
    proxy: 'Playback proxy', login: 'Sign in', clearSaved: 'Clear saved', logs: 'Logs',
    loginHint: 'Tip: focus a field and press OK to type; press OK again to move to the next field; Back ends input',
    inputNextHint: 'Press OK to move to the next field, Back to end input',
    search: 'Search', settings: 'Settings', loading: 'Loading…', filter: 'Filter', reset: 'Reset',
    filterHint: 'Filters apply instantly; press Filter again to close',
    kbPlaceholder: 'Type title initials, e.g. LLDQ', kbChinese: 'Chinese input', kbLetters: 'Letter keyboard',
    searchHintKb: 'Pick letters with the D-pad and OK (initials work, e.g. LLDQ); then press Search',
    searchHintText: 'After typing, press OK or ↓ to jump to the Search button, then OK to search',
    accountLabel: 'Account: ', logMgmt: 'Log management', logout: 'Sign out (to login screen)',
    wipe: 'Clear saved credentials', back: '← Back', prefsLocal: 'Preferences are stored on this TV',
    exportNas: 'Export to NAS', importNas: 'Import from NAS', clearLog: 'Clear logs',
    prevEp: '⏮ Prev', nextEp: 'Next ⏭', episodes: 'Episodes', subtitlesBtn: 'Subtitles', audioBtn: 'Audio',
    playerHint: '←/→ Seek · ↑ Big step · ↓ Controls · OK Play/Pause · Back Exit',
    on: 'On', off: 'Off', yes: 'Yes', no: 'No',
    continueWatching: 'Continue Watching', viewAll: 'View all →', connected: 'Connected ',
    loadingLibs: 'Loading libraries…', noLibs: 'No libraries',
    libsFail: 'Failed to load libraries: ', continueFail: 'Failed to load Continue Watching: ',
    loginBusy: 'Signing in…', autoLoginBusy: 'Auto sign-in…', loginOk: 'Signed in',
    loginFail: 'Sign-in failed: ', loginNeed: 'Server, account and password are all required',
    loggedOut: 'Signed out', wiped: 'Saved credentials cleared',
    searchFirst: 'Enter a keyword first', searching: 'Searching…', searchFail: 'Search failed: ',
    setProxy: 'Playback/image proxy: ', notSet: 'Not set', setRatio: 'Default aspect: ',
    setAutoNext: 'Auto-play next episode: ', setResume: 'Resume playback: ',
    setSeek: 'Seek step: ', seconds: 's', setOsd: 'Controls auto-hide: ',
    setScale: 'Focus zoom: ', setTz: 'Clock timezone: ', tzAuto: 'Auto (follow TV)',
    setLang: 'Language: ', langSwitched: 'Language switched, restarting…',
    lastSync: 'Last sync: ', notSynced: 'Not synced',
    logRec: 'Log recording: ', logHintT: 'Log hints: ', noLogs: '(no logs yet)',
    importNeed: 'Not signed in or no proxy set', importing: 'Importing from NAS…',
    logCleared: 'Logs cleared',
    play: '▶ Play', resumePlay: '▶ Resume', markWatched: 'Mark as watched',
    markedWatched: 'Marked as watched', opFail: 'Failed: ', epsFail: 'Failed to load episodes: ',
    seasonWord: 'Season', watchedBadge: 'Watched', typeVideo: 'Video', typeFolder: 'Folder',
    loading2: 'Loading…', loadingSub: 'Loading subtitles…', paused: '❚❚ Paused', pauseBtn: '❚❚ Pause',
    playBtn: '▶ Play', aspectPrefix: 'Aspect: ', playingNow: ' (playing)',
    dimType: 'Category', dimGenres: 'Genre', dimResolution: 'Resolution', dimColor: 'Dynamic range',
    dimAudio: 'Audio', dimLocate: 'Country/Region', dimDecade: 'Release year',
    dimRecognition: 'Match status', dimWatched: 'Watched',
    all: 'All', movie: 'Movie', tv: 'TV Show', watchedYes: 'Watched', watchedNo: 'Unwatched',
    thisYear: 'This year', rec0: 'Not matched', rec1: 'Matched', rec2: 'NFO',
    atmos: 'Dolby Atmos', stereo: 'Stereo', other: 'Other',
    buffering: 'Buffering…', playError: 'Playback error', resumeFromA: 'Resuming from ', resumeFromB: '',
    introSkipped: 'Intro skipped', subOff: 'Subtitles off', importFail: 'Import failed: ',
    logSynced: 'Logs synced to NAS', logSyncTimeout: 'Log sync failed (timeout)', logSyncNet: 'Log sync failed (network)', logSyncFailA: 'Log sync failed (',
    untitled: '(Untitled)', toastNext: 'Next episode', noEpInfo: '(No episode info)',
    switchedTo: 'Switched to ', switchFail: 'Switch failed: ',
    genreFallback: 'Genre ', statusFallback: 'Status '
  }
};
function langIsEn() { return PREFS.lang === 'en'; }
function t(k) {
  var d = I18N[langIsEn() ? 'en' : 'zh'];
  return d[k] || I18N.zh[k] || k;
}
function fmtTotal(n) { return langIsEn() ? String(n) : '共 ' + n; }
function fmtFound(n) { return langIsEn() ? ('Found ' + n) : ('找到 ' + n + ' 条'); }
function fmtLogCount(n) { return langIsEn() ? (n + ' log lines') : ('当前日志共 ' + n + ' 行'); }
function epLabel(n) { return langIsEn() ? ('E' + n) : ('第' + n + '集'); }
function seasonLabel(n, title) {
  if (title) return title;
  return langIsEn() ? ('Season ' + n) : ('第' + n + '季');
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
