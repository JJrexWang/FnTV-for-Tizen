# FnTV for Tizen

**An unofficial fnOS （飞牛） media client for Samsung Tizen TVs.**

[中文说明 / Chinese README](README.zh-CN.md)

fnOS (Feiniu NAS OS) ships an official TV client only for Android TV and
Apple TV. FnTV for Tizen brings your fnOS movie & TV library to Samsung
Tizen TVs as a native `.wgt` web app: browse libraries and posters, pick up
where you left off, and play with Samsung's AVPlay engine — no extra box
needed.

> **Unofficial project.** FnTV for Tizen is a third-party client built
> against the same private API the official fnOS web client uses. It is
> not affiliated with, or endorsed by, Feiniu (fnOS) or Samsung. You use
> it with **your own** fnOS server and **your own** media library.

Tested on a Samsung QA85Q70TAJ (85" Q70T, Tizen 5.5). Current version:
**1.3.2**.

## Features

- **Home** — Continue Watching row with progress bars and remaining time,
  plus one poster row per media library.
- **Details** — Series with seasons and episode cards, numbered episode
  chips in an aligned grid, collections with numbered entries, mark as
  watched, resume playback picks the right episode automatically.
- **Player** — AVPlay hardware playback with a tvOS-style glass control
  bar: seek bar as a first-class focus stop, play/pause, previous/next
  episode, episode picker, subtitle and audio-track panels, display mode
  (fit / fill / zoom), auto next-episode, periodic progress reporting back
  to the server.
- **Subtitles** — External subtitle files (SRT/ASS/VTT, converted by the
  proxy) are rendered by the app itself as an overlay. (AVPlay cannot
  render embedded ASS tracks; see *Limitations*.)
- **Search** — Full-library search with a TV-friendly focus flow.
- **Settings** — Display mode, auto-play next, resume, seek step, control
  bar auto-hide, focus zoom level, clock time zone override, log
  management.
- **Remote-first UI** — Geometric focus navigation tuned for a TV remote,
  adjustable focus zoom (106–122 %), no mouse required anywhere.

## How it works

```
┌──────────────┐   fnOS API (signed)   ┌────────────────┐
│  TV app      │ ────────────────────▶ │  fnOS server   │
│  (.wgt)      │                       │  :5666         │
│              │   media / posters /   └────────────────┘
│              │   subtitles via        ▲
│              │ ────────────────────▶ ┌────────────────┐
└──────────────┘                       │  fntv-proxy    │
        AVPlay streams through proxy   │  (Docker, NAS) │
                                       │  :18090        │
                                       └────────────────┘
```

Samsung's AVPlay player cannot attach custom HTTP headers, but fnOS media
URLs require an `Authorization` token and an `Authx` signature header — a
direct stream URL is rejected. The small **fntv-proxy** (a single-file
Python service, Docker image included) runs next to fnOS and:

- injects the auth headers into media streams (`/play/<guid>`),
- relays poster images with a corrected `Content-Length` (the TV's
  Chromium drops images whose declared length mismatches),
- downloads external subtitle files and converts ASS/VTT to SRT
  (`/sub/<guid>`),
- optionally collects the TV app's diagnostic log (`/log`,
  `/log-file`).

Everything else (login, library, metadata, playback progress) goes from
the TV straight to your fnOS server.

## Requirements

- A Samsung TV running Tizen (developed and tested on Tizen 5.5; the app
  sticks to Chromium-69-era web features).
- An fnOS server with the Feiniu Movies （飞牛影视） service, reachable
  from the TV.
- A Docker host for the proxy — normally the fnOS machine itself.
- A way to sideload `.wgt` packages: [Apps2Samsung](#install-with-apps2samsung)
  (recommended) or Tizen Studio with a Samsung certificate.

## Deployment

### 1. Run the proxy on your NAS

```bash
git clone https://github.com/JJrexWang/FnTV-for-Tizen.git
cd FnTV-for-Tizen/proxy
# provide the signing constants first (next section), then:
docker compose up -d
```

The compose file uses host networking: the proxy reaches fnOS at
`127.0.0.1:5666` and listens on port **18090**.

#### Proxy configuration — the signing constants

fnOS signs API requests with an `api_key` / `api_secret` pair (the
`Authx` header). These are **not** your account credentials: they are
constants shipped inside the official fnOS web client, and every
open-source fnOS client uses the same pair. The proxy needs them for the
media/subtitle requests it signs on behalf of the TV.

Provide them in either of two ways (see `proxy/docker-compose.yml`):

- **Environment variables** `FNTV_API_KEY` / `FNTV_API_SECRET`, or
- **A `.apicred` file** next to `proxy.py` (copy `proxy/.apicred.example`):
  the two constants separated by whitespace, mounted to `/app/.apicred`.

You can read the values out of the official web client's JavaScript
(search for `api_key` in the fnOS web UI bundle) — they are the same for
every fnOS installation.

> Never commit a real `.apicred` to git; it is in `.gitignore`.

### 2. Install the TV app

Grab `FnTV.wgt` from the
[Releases](https://github.com/JJrexWang/FnTV-for-Tizen/releases) page, or
build it yourself (see *Build*), then install it with Apps2Samsung
(next section) or Tizen Studio.

### 3. First launch

Fill in:

| Field | Value |
| --- | --- |
| Server | `http://<your-nas-ip>:5666` |
| Account / Password | Your fnOS account |
| Playback proxy | `http://<your-nas-ip>:18090` |

The credentials are stored only in the TV's local storage; the login
token is never persisted.

## Install with Apps2Samsung

[Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung) is a
one-click installer for Samsung Tizen TVs (Windows / macOS / Linux /
Android). It finds your TV, creates a Samsung signing certificate for it
and installs `.wgt` / `.tpk` packages — no Tizen Studio needed. FnTV's
installation follows the standard Apps2Samsung flow:

1. **Download Apps2Samsung** from its
   [GitHub Releases](https://github.com/Apps2Samsung/Apps2Samsung/releases)
   and install it on your phone or computer.
2. **Prepare the TV**: put the TV and the phone/computer on the same
   network; Apps2Samsung walks you through enabling the TV's developer
   mode and pairing.
3. **Install FnTV**, either way:
   - **From the community catalog** — FnTV is submitted to
     [Apps2Samsung/tizen-community-packages](https://github.com/Apps2Samsung/tizen-community-packages)
     (catalog entry: `apps2samsung/package.json` in this repo). Once
     listed, just pick **FnTV for Tizen** in the Apps2Samsung release list
     and install.
   - **From a file** — download `FnTV.wgt` from this repo's
     [Releases](https://github.com/JJrexWang/FnTV-for-Tizen/releases),
     choose *Install from file* in Apps2Samsung and select it.
4. Apps2Samsung **signs the package for your TV automatically** and
   installs it. Launch **FnTV** from the TV's app list and sign in
   (see *First launch*).

> Updating works the same way: install the newer `.wgt` over the old
> one — your settings and login are kept.

## Build

```bash
./build.sh        # produces FnTV.wgt in the repo root
```

The script simply zips `app/` with `config.xml` at the archive root —
a hard requirement: if the files sit in a subfolder, the TV rejects the
package with "No target entry found".

## Limitations

- **Embedded subtitles**: AVPlay does not render embedded ASS tracks,
  and the fnOS API only serves external subtitle files. External
  subtitles are fully supported (rendered by the app); embedded-only
  tracks cannot be displayed.
- **Tizen web runtime**: the app targets the Chromium 69 feature level
  of Tizen 5.5 (no optional chaining, no flex `gap`, no
  `backdrop-filter`).
- The fnOS API is private and may change with fnOS updates.

## Credits

- API behaviour referenced from the open-source
  [fntv-electron](https://github.com/QiaoKes/fntv-electron) project.
- `app/md5.js` and `app/sha1.js` are the well-known public-domain-style
  JavaScript implementations by Paul Johnston et al. and Angel Marin /
  geraintluff.
- Thanks to the [Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung)
  project and the Tizen community package catalog for making Tizen
  sideloading painless.

## License

MIT — see [LICENSE](LICENSE).
