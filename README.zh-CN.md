# FnTV for Tizen

**非官方的飞牛 fnOS 影视客户端 —— 三星 Tizen 电视版。**

[English README](README.md)

飞牛官方电视客户端只有 Android TV 与 Apple TV 两个版本。FnTV for Tizen
把你的飞牛影视库带到三星 Tizen 电视上：原生 `.wgt` 网页应用，浏览媒体
库与海报墙、断点续播、用三星 AVPlay 引擎播放，不需要再外接电视盒子。

> **非官方项目。** 本项目是基于飞牛官方 Web 客户端同款私有接口开发的
> 第三方客户端，与飞牛（fnOS）、三星均无隶属或授权关系。请只用于你
> **自己的** 飞牛服务器和 **自己的** 媒体库。

已在三星 QA85Q70TAJ（85" Q70T，Tizen 5.5）上实测。当前版本：**1.6.0**。

## 功能

- **主页** —— 「继续观看」一行（带进度条与剩余时长），加每个媒体库
  一行海报墙。
- **详情页** —— 剧集的季/集卡片、行列对齐的数字选集按钮、合集番号
  选集、标为已看；点播放会自动选对续播集。
- **播放器** —— AVPlay 硬件播放，tvOS 风格玻璃播控条：进度条本身是
  一级焦点位，播放/暂停、上一集/下一集、选集面板、字幕/音轨面板、
  画面模式（适应/填充/放大）、完播自动下一集、播放进度定时回传
  服务器。
- **字幕** —— 外挂字幕文件（SRT/ASS/VTT，经代理转换）由应用自绘
  覆盖层显示。（AVPlay 无法渲染内嵌 ASS 轨道，见「已知限制」。）
- **搜索** —— 全库搜索，焦点流程针对电视遥控器优化。
- **中英文双语界面** —— 设置里可切换（切换后应用会重启生效）。
- **设置** —— 画面模式、自动连播、断点续播、快进步长、播控条自动
  隐藏、焦点放大比例、时钟时区覆盖、日志管理。
- **遥控优先的界面** —— 几何焦点导航，焦点放大可调（106%–122%），
  全程不需要鼠标。

## 工作原理

```
┌──────────────┐   飞牛 API（签名）    ┌────────────────┐
│  电视端 App  │ ────────────────────▶ │  飞牛服务器    │
│  (.wgt)      │                       │  :5666         │
│              │   媒体流/海报/字幕     └────────────────┘
│              │   经代理中转           ▲
│              │ ────────────────────▶ ┌────────────────┐
└──────────────┘                       │  fntv-proxy    │
        AVPlay 经代理播放              │ （Docker，NAS）│
                                       │  :18090        │
                                       └────────────────┘
```

三星 AVPlay 播放器不能给请求加自定义 HTTP 头，而飞牛的媒体地址必须
带 `Authorization` 令牌与 `Authx` 签名头，直链会被拒绝。所以需要
一个跑在飞牛旁边的小代理 **fntv-proxy**（单文件 Python 服务，附
Docker 镜像），它负责：

- 给媒体流补上鉴权头（`/play/<guid>`）；
- 中继海报图片并修正 `Content-Length`（电视的 Chromium 对长度对
  不上的图片会直接丢弃）；
- 下载外挂字幕文件并把 ASS/VTT 转成 SRT（`/sub/<guid>`）；
- 可选地收集电视端的排障日志（`/log`、`/log-file`）。

其余请求（登录、媒体库、元信息、播放进度）由电视直连飞牛服务器。

## 环境要求

- 一台三星 Tizen 电视（在 Tizen 5.5 上开发与实测；应用只用了
  Chromium 69 级别的网页特性）。
- 一台运行飞牛影视服务的 fnOS 服务器，电视能访问到。
- 一台能跑 Docker 的机器放代理 —— 一般就是飞牛主机本身。
- 一个侧载 `.wgt` 的办法：[Apps2Samsung](#用-apps2samsung-安装)
  （推荐），或带三星证书的 Tizen Studio。

## 部署步骤

### 1. 在 NAS 上跑起代理

```bash
git clone https://github.com/JJrexWang/FnTV-for-Tizen.git
cd FnTV-for-Tizen/proxy
# 先配好签名常量（见下一节），然后：
docker compose up -d
```

compose 使用 host 网络：代理通过 `127.0.0.1:5666` 访问飞牛，
对外监听 **18090** 端口。

#### 代理配置 —— 签名常量

飞牛用一对 `api_key` / `api_secret` 给 API 请求签名（`Authx` 头）。
它们**不是**你的账号密码，而是飞牛官方 Web 客户端内置的常量，所有
开源飞牛客户端用的都是同一对。代理替电视签名媒体/字幕请求时需要
它们。

两种提供方式任选其一（见 `proxy/docker-compose.yml`）：

- **环境变量** `FNTV_API_KEY` / `FNTV_API_SECRET`；或
- **`.apicred` 文件**，放在 `proxy.py` 旁边（复制
  `proxy/.apicred.example`）：两个常量以空白分隔，挂载到
  `/app/.apicred`。

取值可以在飞牛 Web 界面的 JavaScript 里找到（搜 `api_key`）——
每台飞牛都一样。

> 不要把真实的 `.apicred` 提交进 git，它已在 `.gitignore` 里。

### 2. 安装电视端 App

从 [Releases](https://github.com/JJrexWang/FnTV-for-Tizen/releases)
下载 `FnTV.wgt`，或自行构建（见「构建」），然后用 Apps2Samsung
（下一节）或 Tizen Studio 安装。

### 3. 首次启动

按下面填：

| 字段 | 填法 |
| --- | --- |
| 服务器 | `http://<你的NAS地址>:5666` |
| 账号 / 密码 | 你的飞牛账号 |
| 播放代理 | `http://<你的NAS地址>:18090` |

账号密码只保存在电视本机存储里，登录令牌不落盘。

## 用 Apps2Samsung 安装

[Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung) 是
三星 Tizen 电视的一键安装工具（Windows / macOS / Linux /
Android）：它能找到你的电视、为电视生成三星签名证书并安装
`.wgt` / `.tpk` 包，不需要 Tizen Studio。FnTV 按 Apps2Samsung
的标准流程安装：

1. **下载 Apps2Samsung**：从它的
   [GitHub Releases](https://github.com/Apps2Samsung/Apps2Samsung/releases)
   下载，装到手机或电脑上。
2. **准备电视**：电视与手机/电脑连同一个网络；Apps2Samsung 会
   引导你开启电视的开发者模式并完成配对。
3. **安装 FnTV**，两种方式任选：
   - **从社区目录装** —— FnTV 已提交到
     [Apps2Samsung/tizen-community-packages](https://github.com/Apps2Samsung/tizen-community-packages)
     社区目录（目录条目就是本仓库的 `apps2samsung/package.json`）。
     上架后在 Apps2Samsung 的发布列表里选 **FnTV for Tizen**
     即可安装。
   - **从文件装** —— 从本仓库
     [Releases](https://github.com/JJrexWang/FnTV-for-Tizen/releases)
     下载 `FnTV.wgt`，在 Apps2Samsung 里选「从文件安装」。
4. Apps2Samsung 会**自动为你的电视签名**并完成安装。在电视的
   应用列表里打开 **FnTV**，按「首次启动」登录即可。

> 升级同理：把新版 `.wgt` 覆盖安装，设置与登录信息都会保留。

## 构建

```bash
./build.sh        # 在仓库根目录生成 FnTV.wgt
```

脚本就是把 `app/` 打成 zip 并保证 `config.xml` 在压缩包根目录
—— 这是硬性要求：文件多套一层目录，电视会报
"No target entry found" 拒绝安装。

## 已知限制

- **内嵌字幕**：AVPlay 不渲染内嵌 ASS 轨道，飞牛接口也只提供
  外挂字幕文件。外挂字幕完整支持（应用自绘显示）；只有内嵌轨道
  的字幕无法显示。
- **Tizen 网页运行时**：应用按 Tizen 5.5 的 Chromium 69 特性
  级别编写（不用可选链、不用 flex `gap`、不用
  `backdrop-filter`）。
- 飞牛接口是私有接口，飞牛升级后可能变化。

## 致谢

- 接口行为参考了开源项目
  [fntv-electron](https://github.com/QiaoKes/fntv-electron)。
- `app/md5.js`、`app/sha1.js` 是 Paul Johnston 等与 Angel Marin /
  geraintluff 的知名公共领域风格 JavaScript 实现。
- 感谢 [Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung)
  项目与 Tizen 社区包目录，让 Tizen 侧载变得无痛。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
