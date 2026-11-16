#!/usr/bin/env python3
"""FnTV playback proxy for the Tizen PoC client.

AVPlay cannot set Authorization/Authx headers, and fnOS's media range
endpoint requires them. This proxy sits on the NAS next to fnOS:
the TV asks  GET /play/<media_guid>?t=<token>  (no headers needed),
the proxy adds Authorization + a fresh Authx signature + Cookie and
streams the upstream response back, passing Range through both ways.
Same architecture as fntv-electron's local proxy, relocated to the NAS.

Env:
  UPSTREAM  fnOS base URL on this host (default http://127.0.0.1:5666)
  PORT      listen port (default 18090)
"""
import hashlib
import json
import os
import random
import re
import shutil
import ssl
import time
import urllib.parse
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

UPSTREAM = os.environ.get("UPSTREAM", "http://127.0.0.1:5666").rstrip("/")
PORT = int(os.environ.get("PORT", "18090"))

# fnOS web-client signing constants (from the public web client,
# as extracted in ../probe.py; kept server-side only)
def _load_apicred():
    k = os.environ.get("FNTV_API_KEY", "")
    s = os.environ.get("FNTV_API_SECRET", "")
    if k and s:
        return k, s
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".apicred"), "r", encoding="utf-8") as f:
            parts = f.read().split()
        if len(parts) >= 2:
            return parts[0], parts[1]
    except OSError:
        pass
    return "", ""
API_KEY, API_SECRET = _load_apicred()


def md5(s):
    return hashlib.md5(s.encode()).hexdigest()


def gen_authx(url, data_json=""):
    nonce = str(random.randint(100000, 999999))
    ts = str(int(time.time() * 1000))
    sign = md5("_".join([API_KEY, url, nonce, ts, md5(data_json), API_SECRET]))
    return f"nonce={nonce}&timestamp={ts}&sign={sign}"


LOG_DIR = os.environ.get("LOG_DIR", "/logs")
LOG_FILE = os.path.join(LOG_DIR, "fntv-tv.log")


def token_valid(token):
    """Check a trimemedia token against the upstream (mediadb requires auth).

    Returns (ok, detail) where detail describes the upstream verdict,
    so failed syncs can be diagnosed from attempts.log on the NAS.
    """
    if not token or len(token) < 8:
        return False, "no-token"
    path = "/v/api/v1/mediadb/list"
    headers = {
        "Authorization": token,
        "Authx": gen_authx(path),
        "Cookie": "mode=relay",
    }
    req = urllib.request.Request(UPSTREAM + path, headers=headers, method="GET")
    ctx = ssl._create_unverified_context() if UPSTREAM.startswith("https") else None
    try:
        with urllib.request.urlopen(req, timeout=8, context=ctx) as resp:
            data = json.loads(resp.read().decode("utf-8", "replace"))
        return data.get("code") == 0, "upstream-code=%s" % data.get("code")
    except Exception as e:
        return False, "upstream-error=%s" % type(e).__name__


WATCH_FIELDS = ["poster", "posters", "backdrops", "still_path", "cover", "thumb",
                "thumbnail", "image", "images", "backdrop", "fanart", "artwork"]


def _san(v, limit=100):
    if v is None or v == "":
        return "EMPTY"
    v = str(v).replace("/", "§").replace(" ", "_")
    v = re.sub(r'["\'\\\\?&=+%@#<>|*:\x00-\x1f]', "", v)
    while len(v.encode("utf-8")) > limit:
        v = v[:-1]
    return v or "EMPTY"


def build_markers():
    """Parse the newest sync section of the TV log and mirror the decisive
    fields into marker FILENAMES under logs/markers/ (readable via file ls,
    since file contents cannot be read back through the fnOS CLI)."""
    mdir = os.path.join(LOG_DIR, "markers")
    shutil.rmtree(mdir, ignore_errors=True)
    os.makedirs(mdir, exist_ok=True)
    try:
        with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()
    except OSError:
        open(os.path.join(mdir, "NO-LOG-FILE"), "w").close()
        return
    lines = text.splitlines()
    n_img = 0
    n_fail = 0
    for ln in lines:
        if ln.startswith("IMGRAW["):
            n_img += 1
            where = ln[len("IMGRAW["):ln.find("]")] if "]" in ln else "?"
            def grab(field, nxt):
                m = re.search(re.escape(field) + r"=(.*?)(?: " + re.escape(nxt) + r"=|$)", ln)
                return m.group(1) if m else None
            poster = grab("poster", "posters")
            posters = grab("posters", "backdrops")
            backdrops = grab("backdrops", "still")
            still = grab("still", "\x00")
            km = re.search(r"keys=(\S+)", ln)
            keys = km.group(1).split(",") if km else []
            has = ",".join([f for f in WATCH_FIELDS if f in keys]) or "none"
            for name in (
                "R%02d-where-%s" % (n_img, _san(where, 60)),
                "R%02d-poster-%s" % (n_img, _san(poster)),
                "R%02d-posters-%s" % (n_img, _san(posters)),
                "R%02d-backdrops-%s" % (n_img, _san(backdrops)),
                "R%02d-still-%s" % (n_img, _san(still)),
                "R%02d-has-%s" % (n_img, _san(has, 80)),
            ):
                open(os.path.join(mdir, name), "w").close()
        elif "图片失败[" in ln:
            n_fail += 1
            tm = re.search(r"图片失败\[(.*?)\]: (.*)$", ln)
            title = tm.group(1) if tm else "?"
            rest = tm.group(2) if tm else ""
            pm = re.search(r"[?&]p=([^&]+)", rest)
            if pm:
                decoded = urllib.parse.unquote(pm.group(1))
            elif "无图" in rest:
                decoded = "NO-CANDIDATES"
            else:
                decoded = rest
            open(os.path.join(mdir, "F%02d-%s-%s" % (n_fail, _san(title, 50), _san(decoded, 110))), "w").close()
    open(os.path.join(mdir, "SUMMARY-imgraw%d-fails%d" % (n_img, n_fail)), "w").close()


SUB_KEYS = ("字幕", "setExternal", "setSelectTrack", "Download", "AVPlay", "track", "轨道")


def build_sub_markers():
    """Mirror subtitle/player lines from the newest sync section of the TV
    log into marker filenames under logs/submarkers/ — the subtitle
    pipeline's steps (download, setExternalSubtitlePath, track selection)
    can then be read back through fnOS file ls like the image markers."""
    mdir = os.path.join(LOG_DIR, "submarkers")
    shutil.rmtree(mdir, ignore_errors=True)
    os.makedirs(mdir, exist_ok=True)
    try:
        with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()
    except OSError:
        open(os.path.join(mdir, "NO-LOG-FILE"), "w").close()
        return
    idx = text.rfind("===== sync ")
    if idx >= 0:
        text = text[idx:]
    n = 0
    for ln in text.splitlines():
        if not any(k in ln for k in SUB_KEYS):
            continue
        n += 1
        if n > 60:
            break
        open(os.path.join(mdir, "U%02d-%s" % (n, _san(ln.strip(), 150))), "w").close()
    open(os.path.join(mdir, "USUMMARY-sub%d" % n), "w").close()


HITS = []  # last requests seen by this process: "METHOD path"


def note_hit(method, path):
    HITS.append("%s %s" % (method, path))
    del HITS[:-16]


def build_hit_markers():
    mdir = os.path.join(LOG_DIR, "hits")
    shutil.rmtree(mdir, ignore_errors=True)
    os.makedirs(mdir, exist_ok=True)
    for i, h in enumerate(HITS):
        open(os.path.join(mdir, "H%02d-%s" % (i + 1, _san(h, 120))), "w").close()
    open(os.path.join(mdir, "HSUMMARY-n%d" % len(HITS)), "w").close()


IMG_RELAYS = []  # last /img relay outcomes: (kind, status, ctype, path)
IMG_ANALYSIS = []  # last image payload analyses: (fmt, dims, path)


def analyze_image(data):
    """Identify the real format of an image payload from its magic bytes."""
    try:
        if len(data) >= 3 and data[0] == 0xFF and data[1] == 0xD8 and data[2] == 0xFF:
            # JPEG: scan for SOF0/SOF2 to get dimensions
            i = 2
            while i + 9 < len(data):
                if data[i] != 0xFF:
                    i += 1
                    continue
                m = data[i + 1]
                if m in (0xC0, 0xC1, 0xC2):
                    h = (data[i + 5] << 8) | data[i + 6]
                    w = (data[i + 7] << 8) | data[i + 8]
                    return "JPEG", "%dx%d" % (w, h)
                if m in (0xD8, 0x01) or 0xD0 <= m <= 0xD9:
                    i += 2
                    continue
                seg = (data[i + 2] << 8) | data[i + 3]
                if seg < 2:
                    break
                i += 2 + seg
            return "JPEG", "?"
        if len(data) >= 8 and data[:8] == b"\x89PNG\r\n\x1a\n":
            if len(data) >= 24:
                w = int.from_bytes(data[16:20], "big")
                h = int.from_bytes(data[20:24], "big")
                return "PNG", "%dx%d" % (w, h)
            return "PNG", "?"
        if len(data) >= 20 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            chunk = data[12:16]
            if chunk == b"VP8 " and len(data) >= 30:
                w = (data[26] | (data[27] << 8)) & 0x3FFF
                h = (data[28] | (data[29] << 8)) & 0x3FFF
                return "WEBP-VP8", "%dx%d" % (w, h)
            if chunk == b"VP8L" and len(data) >= 25:
                b = data[21:25]
                w = (b[0] | ((b[1] & 0x3F) << 8)) + 1
                h = ((b[1] >> 6) | (b[2] << 2) | ((b[3] & 0x0F) << 10)) + 1
                return "WEBP-VP8L", "%dx%d" % (w, h)
            if chunk == b"VP8X" and len(data) >= 30:
                flags = data[20]
                w = (data[24] | (data[25] << 8) | (data[26] << 16)) + 1
                h = (data[27] | (data[28] << 8) | (data[29] << 16)) + 1
                extra = ""
                if flags & 0x02:
                    extra = "+ANIM"
                if flags & 0x10:
                    extra += "+ALPHA"
                return "WEBP-VP8X" + extra, "%dx%d" % (w, h)
            return "WEBP-" + chunk.decode("ascii", "replace"), "?"
        if len(data) >= 12 and data[4:8] == b"ftyp":
            brand = data[8:12].decode("ascii", "replace")
            return "ISOBMFF-" + brand, "?"
        if len(data) >= 4 and data[:4] == b"GIF8":
            return "GIF", "?"
        return "UNKNOWN-" + data[:8].hex(), "?"
    except Exception as e:
        return "ERR-" + type(e).__name__, "?"


def note_img(kind, status, ctype, path):
    IMG_RELAYS.append((kind, status, ctype, path))
    del IMG_RELAYS[:-40]


def build_img_markers():
    mdir = os.path.join(LOG_DIR, "imgmarkers")
    shutil.rmtree(mdir, ignore_errors=True)
    os.makedirs(mdir, exist_ok=True)
    for i, (kind, status, ctype, path) in enumerate(IMG_RELAYS):
        ct = (ctype or "?").split(";")[0].replace("/", "_")
        open(os.path.join(mdir, "%s%02d-%s-%s-%s" % (kind, i + 1, status, ct, _san(path, 95))), "w").close()
    for i, (fmt, dims, path) in enumerate(IMG_ANALYSIS):
        open(os.path.join(mdir, "A%02d-%s-%s-%s" % (i + 1, fmt, dims, _san(path, 80))), "w").close()
    open(os.path.join(mdir, "ISUMMARY-n%d" % len(IMG_RELAYS)), "w").close()


def decode_sub_text(raw):
    for enc in ("utf-8-sig", "gb18030"):
        try:
            t = raw.decode(enc)
            if t.count("�") <= max(2, len(t) // 200):
                return t
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode("utf-8", "replace")


def _srt_ts(h, m, s, ms):
    return "%02d:%02d:%02d,%03d" % (h, m, s, ms)


def _ass_ts(v):
    m = re.match(r"(\d+):(\d{2}):(\d{2})\.(\d{2})", v.strip())
    if not m:
        return None
    return _srt_ts(int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4)) * 10)


def ass_to_srt(text):
    fmt = None
    in_events = False
    cues = []
    for ln in text.splitlines():
        s = ln.strip()
        low = s.lower()
        if low == "[events]":
            in_events = True
            continue
        if not in_events:
            continue
        if s.startswith("["):
            break
        if low.startswith("format:"):
            fmt = [x.strip().lower() for x in s[len("Format:"):].split(",")]
            continue
        if low.startswith("dialogue:") and fmt:
            parts = s[len("Dialogue:"):].split(",", len(fmt) - 1)
            if len(parts) < len(fmt):
                continue
            d = dict(zip(fmt, parts))
            start = _ass_ts(d.get("start", ""))
            end = _ass_ts(d.get("end", ""))
            txt = re.sub(r"\{[^}]*\}", "", d.get("text", ""))
            txt = txt.replace("\\N", "\n").replace("\\n", "\n").replace("\\h", " ").strip()
            if start and end and txt:
                cues.append((start, end, txt))
    cues.sort(key=lambda c: c[0])
    return "\n".join("%d\n%s --> %s\n%s\n" % (i + 1, a, b, t) for i, (a, b, t) in enumerate(cues))


def _vtt_ts(v):
    v = v.strip().split(" ")[0].replace(",", ".")
    parts = v.split(":")
    try:
        if len(parts) == 2:
            h, m, rest = 0, int(parts[0]), parts[1]
        else:
            h, m, rest = int(parts[0]), int(parts[1]), parts[2]
        s, _, ms = rest.partition(".")
        return _srt_ts(h, m, int(s), int((ms + "000")[:3]))
    except (ValueError, IndexError):
        return None


def vtt_to_srt(text):
    cues = []
    cur = None
    for ln in text.splitlines():
        if "-->" in ln:
            if cur:
                cues.append(cur)
            a, b = ln.split("-->", 1)
            cur = [_vtt_ts(a), _vtt_ts(b), []]
        elif cur is not None:
            if ln.strip() == "":
                cues.append(cur)
                cur = None
            else:
                cur[2].append(re.sub(r"<[^>]+>", "", ln))
    if cur:
        cues.append(cur)
    out = []
    for a, b, lines in cues:
        t = "\n".join(lines).strip()
        if a and b and t:
            out.append((a, b, t))
    return "\n".join("%d\n%s --> %s\n%s\n" % (i + 1, a, b, t) for i, (a, b, t) in enumerate(out))


def sami_to_srt(text):
    syncs = re.findall(r"<SYNC Start=(\d+)[^>]*>\s*<P[^>]*>(.*?)(?=<SYNC|\Z)", text, re.S | re.I)
    out = []
    for i, (ms, bodytxt) in enumerate(syncs):
        start = int(ms)
        end = int(syncs[i + 1][0]) if i + 1 < len(syncs) else start + 2000
        t = re.sub(r"<[^>]+>", "", bodytxt).replace("&nbsp;", " ").strip()
        if not t:
            continue
        a = _srt_ts(start // 3600000, (start // 60000) % 60, (start // 1000) % 60, start % 1000)
        b = _srt_ts(end // 3600000, (end // 60000) % 60, (end // 1000) % 60, end % 1000)
        out.append((a, b, t))
    return "\n".join("%d\n%s --> %s\n%s\n" % (i + 1, a, b, t) for i, (a, b, t) in enumerate(out))


def convert_to_srt(text):
    head = text[:4096]
    if "[Script Info]" in head or "Dialogue:" in head:
        return "ass", ass_to_srt(text)
    if text.lstrip().startswith("WEBVTT"):
        return "vtt", vtt_to_srt(text)
    if "<SAMI" in head.upper():
        return "sami", sami_to_srt(text)
    return "srt", text.strip() + "\n"


ATTEMPTS = {"count": 0, "last": "none"}


def note_attempt(result, detail, nbytes):
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    ATTEMPTS["count"] += 1
    ATTEMPTS["last"] = "%s result=%s %s bytes=%d" % (stamp, result, detail, nbytes)
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        with open(os.path.join(LOG_DIR, "attempts.log"), "a", encoding="utf-8") as f:
            f.write(ATTEMPTS["last"] + "\n")
    except Exception:
        pass


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        # keep logs free of query strings (they carry the token)
        print("[proxy]", self.command, urlparse(self.path).path, flush=True)

    def do_POST(self):
        parsed = urlparse(self.path)
        note_hit("POST", parsed.path)
        if parsed.path != "/log":
            self.send_error(404, "not found")
            return
        token = (parse_qs(parsed.query).get("t") or [""])[0]
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        length = max(0, min(length, 256 * 1024))
        body = self.rfile.read(length) if length else b""
        ok, detail = token_valid(token)
        if not ok:
            note_attempt("rejected", detail, len(body))
            self.send_error(403, "bad token")
            return
        try:
            os.makedirs(LOG_DIR, exist_ok=True)
            try:
                if os.path.getsize(LOG_FILE) > 1024 * 1024:
                    os.replace(LOG_FILE, LOG_FILE + ".old")
            except OSError:
                pass
            stamp = time.strftime("%Y-%m-%d %H:%M:%S")
            with open(LOG_FILE, "ab") as f:
                f.write(("\n===== sync %s =====\n" % stamp).encode("utf-8"))
                f.write(body)
                if not body.endswith(b"\n"):
                    f.write(b"\n")
        except Exception as e:
            print("[proxy] log write failed:", type(e).__name__, e, flush=True)
            note_attempt("write-failed", "%s" % type(e).__name__, len(body))
            self.send_error(500, "write failed")
            return
        note_attempt("ok", detail, len(body))
        try:
            build_sub_markers()
        except Exception:
            pass
        out = b'{"ok":true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def do_GET(self):
        parsed = urlparse(self.path)
        note_hit("GET", parsed.path)
        if parsed.path == "/hit-markers":
            try:
                build_hit_markers()
                body = b"hit-markers-built"
            except Exception as e:
                body = ("hit-markers-failed %s" % type(e).__name__).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/img-markers":
            try:
                build_img_markers()
                body = b"img-markers-built"
            except Exception as e:
                body = ("img-markers-failed %s" % type(e).__name__).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/sub-markers":
            try:
                build_sub_markers()
                body = b"sub-markers-built"
            except Exception as e:
                body = ("sub-markers-failed %s" % type(e).__name__).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/log-markers":
            try:
                build_markers()
                body = b"markers-built"
            except Exception as e:
                body = ("markers-failed %s" % type(e).__name__).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/log-status":
            body = ("attempts=%d last=%s" % (ATTEMPTS["count"], ATTEMPTS["last"])).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/log-file":
            token = (parse_qs(parsed.query).get("t") or [""])[0]
            ok, detail = token_valid(token)
            if not ok:
                self.send_error(403, "bad token")
                return
            try:
                with open(LOG_FILE, "rb") as f:
                    body = f.read()
            except OSError:
                body = b""
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/log-selftest":
            try:
                os.makedirs(LOG_DIR, exist_ok=True)
                probe = os.path.join(LOG_DIR, "selftest.txt")
                with open(probe, "w", encoding="utf-8") as f:
                    f.write("write ok %s\n" % time.strftime("%Y-%m-%d %H:%M:%S"))
                body = ("WRITE-OK dir=%s" % LOG_DIR).encode("utf-8")
            except Exception as e:
                body = ("WRITE-FAIL %s: %s" % (type(e).__name__, e)).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/health":
            body = b"ok"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/img":
            # Poster relay: /img?p=<urlencoded fnOS image path>&t=<token>
            # p may also be a full http(s) URL (remote artwork, e.g. TMDB):
            # fetch it server-side without fnOS auth headers.
            p = (parse_qs(parsed.query).get("p") or [""])[0]
            token = (parse_qs(parsed.query).get("t") or [""])[0]
            if not token or not (p.startswith("/v/") or p.startswith("http://") or p.startswith("https://")):
                self.send_error(400, "missing image path or token")
                return
            if p.startswith("http"):
                self._relay_remote(p)
            else:
                self._relay(p, token, ("Content-Type", "Content-Length",
                                       "Cache-Control", "ETag", "Last-Modified"))
            return
        if parsed.path.startswith("/sub/"):
            guid = parsed.path[len("/sub/"):].strip("/")
            if guid.endswith(".srt"):
                guid = guid[:-4]
            token = (parse_qs(parsed.query).get("t") or [""])[0]
            if not guid or not token:
                self.send_error(400, "missing subtitle guid or token")
                return
            self._serve_subtitle(guid, token)
            return
        if not parsed.path.startswith("/play/"):
            self.send_error(404)
            return
        media_guid = parsed.path[len("/play/"):].strip("/")
        token = (parse_qs(parsed.query).get("t") or [""])[0]
        if not media_guid or not token:
            self.send_error(400, "missing media_guid or token")
            return

        upstream_path = f"/v/api/v1/media/range/{media_guid}"
        self._relay(upstream_path, token, ("Content-Type", "Content-Length",
                                            "Content-Range", "Accept-Ranges",
                                            "Cache-Control", "Last-Modified", "ETag"))

    def _serve_subtitle(self, guid, token):
        """Fetch an fnOS subtitle file and serve it as SRT.

        AVPlay only renders external subtitles from a local file in SAMI/
        SRT/TTML form — ASS and VTT (what fnOS usually carries) must be
        converted, which happens here. The TV downloads this via the
        Tizen Download API and passes the local path to AVPlay.
        """
        path = "/v/api/v1/subtitle/dl/" + guid
        headers = {
            "Authorization": token,
            "Authx": gen_authx(path),
            "Cookie": "mode=relay",
            "x-trim-client": "web",
            "x-trim-client-version": "608",
        }
        req = urllib.request.Request(UPSTREAM + path, headers=headers, method="GET")
        ctx = ssl._create_unverified_context() if UPSTREAM.startswith("https") else None
        try:
            resp = urllib.request.urlopen(req, timeout=20, context=ctx)
            status = resp.status
            raw = resp.read(16 * 1024 * 1024)
            resp.close()
        except urllib.error.HTTPError as e:
            status = e.code
            try:
                raw = e.read(65536)
            except Exception:
                raw = b""
        except Exception as e:
            print("[proxy] subtitle fetch error:", type(e).__name__, e, flush=True)
            self.send_error(502, "subtitle fetch failed")
            return
        if status != 200 or not raw or raw.lstrip()[:1] == b"{":
            note_img("B", status, "sub-error", path)
            self.send_error(404, "subtitle unavailable")
            return
        fmt, srt = convert_to_srt(decode_sub_text(raw))
        note_img("B", 200, "sub-" + fmt, path)
        IMG_ANALYSIS.append(("SUB-" + fmt.upper(), "%dcues" % srt.count(" --> "), path))
        del IMG_ANALYSIS[:-20]
        body = srt.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _relay_remote(self, url):
        """Fetch a remote image URL (no fnOS auth); images only, size-capped."""
        url = urllib.parse.quote(url, safe=":/?&=+%@~")
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (SMART-TV; Linux; Tizen 5.5) FnTV",
        }, method="GET")
        ctx = ssl._create_unverified_context() if url.startswith("https") else None
        try:
            resp = urllib.request.urlopen(req, timeout=20, context=ctx)
        except urllib.error.HTTPError as e:
            resp = e
        except Exception as e:
            print("[proxy] remote error:", type(e).__name__, e, flush=True)
            self.send_error(502, "remote unreachable")
            return
        ctype = resp.headers.get("Content-Type", "")
        note_img("W", resp.status, ctype, url)
        if resp.status != 200 or not ctype.startswith("image/"):
            print("[proxy] remote not image:", resp.status, ctype, flush=True)
            self.send_error(404, "not an image")
            resp.close()
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        for h in ("Content-Length", "Cache-Control", "ETag", "Last-Modified"):
            v = resp.headers.get(h)
            if v is not None:
                self.send_header(h, v)
        self.end_headers()
        total = 0
        try:
            while total < 8 * 1024 * 1024:
                chunk = resp.read(256 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            resp.close()

    def _relay(self, upstream_path, token, passthrough_headers):
        """Fetch an fnOS path with auth headers added; stream it back."""
        url = UPSTREAM + urllib.parse.quote(upstream_path, safe="/?&=+%@~")
        sign_path = upstream_path.split("?")[0]
        headers = {
            "Authorization": token,
            "Authx": gen_authx(sign_path),
            "Cookie": "mode=relay",
            "x-trim-client": "web",
            "x-trim-client-version": "608",
            "User-Agent": self.headers.get("User-Agent", "trim_player"),
        }
        if self.headers.get("Range"):
            headers["Range"] = self.headers["Range"]

        req = urllib.request.Request(url, headers=headers, method="GET")
        ctx = ssl._create_unverified_context() if url.startswith("https") else None
        try:
            resp = urllib.request.urlopen(req, timeout=30, context=ctx)
        except urllib.error.HTTPError as e:
            resp = e
        except Exception as e:
            print("[proxy] upstream error:", type(e).__name__, e, flush=True)
            self.send_error(502, "upstream unreachable")
            return

        is_img = upstream_path.startswith("/v/api/v1/sys/img")
        if is_img:
            note_img("S", resp.status, resp.headers.get("Content-Type", ""), upstream_path)
        elif upstream_path.startswith("/v/api/v1/media/range"):
            note_img("P", resp.status, resp.headers.get("Content-Type", ""), upstream_path)
        if is_img and resp.status == 200:
            # Buffer small image payloads to identify their real format
            # (the TV fails some images the proxy fetches fine — the bytes
            # may be a format its old Chromium cannot decode).
            try:
                data = resp.read(10 * 1024 * 1024)
            except Exception:
                data = b""
            fmt, dims = analyze_image(data)
            IMG_ANALYSIS.append((fmt, dims, upstream_path))
            del IMG_ANALYSIS[:-20]
            self.send_response(200)
            for h in passthrough_headers:
                v = resp.headers.get(h)
                if v is not None and h != "Content-Length":
                    self.send_header(h, v)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass
            resp.close()
            return
        self.send_response(resp.status)
        for h in passthrough_headers:
            v = resp.headers.get(h)
            if v is not None:
                self.send_header(h, v)
        self.end_headers()
        try:
            while True:
                chunk = resp.read(256 * 1024)
                if not chunk:
                    break
                self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass  # client went away; normal for playback
        finally:
            resp.close()


if __name__ == "__main__":
    print(f"[proxy] listening on :{PORT}, upstream {UPSTREAM}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
