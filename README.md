# QBot

Qian 的个人体验原型。界面和结构随时可以大改，基本功能能用即可。这份说明给 Qian 自己用 Codex 或 Claude Code 接着改。

源码仓库只有 [FelixZhu/QBot](https://github.com/FelixZhu/QBot)。网页发布在 [https://felixzhu.github.io/QBot/](https://felixzhu.github.io/QBot/)。安卓壳是一个 WebView，打开这个地址。

`FelixZhu/qian-drive` 已经手动删除。开发、预览、发布都不要再克隆它，也不要把它当成前置步骤。`apps/drive-web/README.md`、`apps/qbot-app/README.md` 和 `docs/ARCHITECTURE.md` 仍写着旧站和 1.0.4，那些发布步骤已经过时。以本文件和下面点名的配置为准。视觉规范仍看 [docs/DESIGN.md](docs/DESIGN.md)。

## 现在能用

三个 Tab 都在网页里：对话、主动服务、知识库。外壳是 [`apps/drive-web/template.html`](apps/drive-web/template.html)。宽度小于 600px 用底部 Tab，大于等于 600px 用左侧 72px 导航。

- **对话**在 [`apps/chat-web`](apps/chat-web)。界面可以预览。回复来自 `MockBackend`，只有本地模拟的整段或流式文本。
- **主动服务**是 [`apps/drive-web/feed.js`](apps/drive-web/feed.js) 和 `feed.css`。页面挂载时读站点里的 `out/feed.json`。外部文章交给系统浏览器，不放进 iframe。mp4 / webm 这类文件可以内嵌播放。
- **知识库**是 [`apps/drive-web/kb.js`](apps/drive-web/kb.js) 和 `kb.css`，读站点上的 `index.json`。索引打不开时只显示错误和「重试」。`private/` 不会进清单。
- 浅色、深色、跟随系统已经接上。
- 安卓返回键调用网页里的 `qbotBack`。网页处理不了时，壳会提示「再滑一次退出」。

已安装的 APK 是 1.0.5（versionCode 7），与 [`apps/qbot-app/app.json`](apps/qbot-app/app.json) 里的 `expo.version`、`expo.android.versionCode` 一致。包名是 `io.github.felixzhu.qiandrive`。

## 现在没有

- 真实对话后端。`ChatBackend` 只是接口，仓库里接上的实现是模拟数据。
- 安卓原生语音识别。系统 WebView 用不了浏览器语音识别，麦克风会提示即将上线。
- 通知、私密区解锁。
- 本仓库里没有生成或上传 Feed 的脚本。站点上的 `out/feed.json` 是钉死构建借来的那一份。
- 应用商店包。[`apps/qbot-app/eas.json`](apps/qbot-app/eas.json) 只有 `preview`，产物是内部 APK。没有 iOS 构建配置。GitHub Actions 不打 APK。

`skills/` 是别的个人技能，不参与网页或 APK。`apps/drive-web/sync_modules.sh` 会从别的目录或 `kb-tab` 分支覆盖现有模块，日常不要跑。

## 目录

```
apps/drive-web/    网页外壳、知识库、主动服务、钉死构建
apps/chat-web/     对话 Tab（Vite + React）
apps/qbot-app/     Expo 安卓壳
docs/              视觉规范，以及一份已过时的架构说明
skills/            与本应用构建无关
.github/workflows/pages.yml       推到 main 时发布 Pages
.github/workflows/site-build.yml  PR 上构建和测试，不发布
```

版本看配置，不要抄旧文档里的 1.0.4 / 6：

- 安装包：`apps/qbot-app/app.json` 的 `expo.version` 与 `expo.android.versionCode`。`eas.json` 的 `appVersionSource` 是 `local`。`apps/qbot-app/package.json` 的 `version`（`1.0.0`）不是安装包版本。
- 网页：打开 [version.json](https://felixzhu.github.io/QBot/version.json) 的 `version` 字段，或跑下面的 `preflight_home.py`。这个戳每次构建都会变。

壳的地址写在 [`apps/qbot-app/App.tsx`](apps/qbot-app/App.tsx) 的 `HOME_URL`。

## 环境

Actions 使用 Node.js 22 和 Python 3.12。本地用同一主版本即可。

- 预览对话：在 `apps/chat-web` 安装依赖（有 `package-lock.json`）。
- 预览外壳：在 `apps/qbot-app` 安装依赖。
- 下面标了 Chrome 的测试需要本机 `google-chrome`。
- 打 APK 需要环境变量 `EXPO_TOKEN`。只放在环境里。不要写入仓库、不要写进脚本、不要贴到聊天或日志。
- 上传签名在 Expo 项目 `felixzhu/qian-drive`（`app.json` 的 `owner` 是 `felixzhu`，`slug` 是 `qian-drive`）。密钥库不在本仓库。覆盖安装必须继续用这套签名。
- 日常开发和 Pages 发布不需要 OSS 凭证。只有不带 `--manifest` 和 `--index` 直接跑 `refresh_site.py` 才会读 `OSS_ACCESS_KEY_ID` 和 `OSS_ACCESS_KEY_SECRET`。

公开仓库。不要提交密钥、令牌、邮箱、密钥库、`*.apk`、`node_modules`、`.expo`、字体（`*.woff2` / `*.ttf` / `*.ttc`）、`apps/drive-web/dist` 或 `apps/drive-web/out`。

## 本地预览

对话 Tab，只看界面和模拟回复：

```bash
cd apps/chat-web
npm ci
npm run dev
```

终端会打印本地地址。这不是三个 Tab 的完整站点。

外壳。WebView 打开已经发布的网站，看不到还没发布的网页改动：

```bash
cd apps/qbot-app
npm ci
npx expo start
```

网页改动通常不用重打 APK。已安装的 1.0.5（versionCode 7）刷新后就会打开新页面。只有改了原生行为（返回键、启动页、权限、`HOME_URL`、包名）才升版本再打包。升版本时改 `app.json` 的 `expo.version` 和 `expo.android.versionCode`，并让 [`apps/drive-web/shell-media.js`](apps/drive-web/shell-media.js) 的 `CAPABILITIES.apk` 与 [`apps/drive-web/shell-media.test.mjs`](apps/drive-web/shell-media.test.mjs) 里的断言保持一致，否则下面的最小测试会失败。包名保持 `io.github.felixzhu.qiandrive`。

打新 APK 前先确认页面还在。失败就不要打包：

```bash
python3 apps/qbot-app/preflight_home.py
```

然后：

```bash
cd apps/qbot-app
npx eas-cli@latest build -p android --profile preview --non-interactive
```

`EXPO_TOKEN` 从当前环境读取。这条命令使用 Expo 上已有的上传签名。

## 最小测试

不需要浏览器，也不需要旧站。在仓库根目录执行。`shell-history.test.mjs` 会 `git show` 提交 `0dc920ac`，浅克隆会失败：

```bash
node --test apps/drive-web/shell-history.test.mjs apps/drive-web/shell-media.test.mjs apps/drive-web/shell-back.test.mjs apps/drive-web/shell-theme.test.mjs
python3 apps/drive-web/test_accept_site.py
```

需要本机 Chrome，不访问对象存储：

```bash
node --test apps/drive-web/test/kb.test.mjs
node apps/drive-web/shell-contract.test.mjs
```

## 网页怎么发布

发布只走 [`.github/workflows/pages.yml`](.github/workflows/pages.yml)：

1. 推送到 `main`，或在 Actions 里手动运行 workflow `pages`。
2. 检出本仓库，使用 Node.js 22 和 Python 3.12。
3. 运行 `python3 apps/drive-web/build_pinned.py --repo <临时目录> --strict`。
4. 把该目录作为 Pages artifact，用 `actions/deploy-pages` 部署到环境 `github-pages`。
5. 站点是 [https://felixzhu.github.io/QBot/](https://felixzhu.github.io/QBot/)。构建结果不提交回 git。

[`.github/workflows/site-build.yml`](.github/workflows/site-build.yml) 在 PR 上做同样的构建和测试，不部署。

不要用 `python3 apps/drive-web/refresh_site.py --push` 发布。它默认写到 `/workspace/qian-drive-repo`，并打印旧站地址。

字体、Feed 媒体、已发布的 chat 包、`manifest.json` 和 `index.json` 不在 git 里，由钉死构建按 [`apps/drive-web/pins/inputs.sha256`](apps/drive-web/pins/inputs.sha256) 下载。`build_pinned.py` 和 `accept_site.py` 的默认 origin 仍是 `https://felixzhu.github.io/qian-drive/`。2026-11-18 核对时，这个地址和 `FelixZhu/qian-drive` 仓库都是 404。当时这条命令在下载清单里的第一个文件时失败：

```bash
python3 apps/drive-web/build_pinned.py --repo /tmp/qbot-site
```

`--from-dir` 只能替换构建输入。`--strict` 仍会按 origin 再拉一整棵树做对比。不要为了让构建通过去恢复或克隆已删除的仓库。已经在线上的页面来自更早一次成功的 `pages` 运行，刷新仍可打开；在脚本改到新的字节来源之前，推 `main` 触发的新部署会在同一步失败。

对话源码若与 `apps/drive-web/pins/chat-web.sha256` 不一致，钉死构建会改为本地 `npm run build`。这一步同样要先拿到其余钉死输入。

## Codex 和 Claude Code

两个工具不要共用一个工作目录，也不要一起改 `main`。本机同时开的时候，各用一个 worktree 和一条分支：

```bash
git fetch origin main
git worktree add ../QBot-codex -b codex/主题 origin/main
git worktree add ../QBot-claude -b claude/主题 origin/main
```

各自在自己的目录里提交，再开自己的 PR。不要检出对方正在用的分支。下面两份已经打开的 PR 不要改、不要合并、也不要在新分支里重做：

- [#8](https://github.com/FelixZhu/QBot/pull/8) 知识库从查看器返回后回到列表
- [#6](https://github.com/FelixZhu/QBot/pull/6) 独立的架构边界文档
