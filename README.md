# QBot

Qian 自己用的体验原型。目标是接近能用的应用质感，快，核心流程能走通。不是对外商用，也不是发布准备。界面改网页；只有原生能力才改外壳，并提高 `versionCode`。

源码仓库是 [FelixZhu/QBot](https://github.com/FelixZhu/QBot)。站点是 [https://felixzhu.github.io/QBot/](https://felixzhu.github.io/QBot/)。安卓壳是 WebView，打开这个地址。钉死构建的默认来源也是这个网站。`FelixZhu/qian-drive` 已由 Qian 手动删除，当前构建不再向它取文件。

[`apps/drive-web/README.md`](apps/drive-web/README.md)、[`apps/qbot-app/README.md`](apps/qbot-app/README.md)、[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) 里的旧站、1.0.4 和模块负责人分工不再执行。颜色和字号仍看 [`docs/DESIGN.md`](docs/DESIGN.md)，那些尺寸是实现参考，不是像素级合同。

## 怎么做

Designer 负责设计和一轮视觉核对。Engineer 负责开发、技术验收和整合。知识库、主动服务、Claude 不再分工，也不再审批。重大决定给 Qian。范围已经说清的，不再反复问。

一次只做一个小目标，一条分支只有一个所有者。独立的任务可以并行。已经在做的接着做，不另开重复的。[#12](https://github.com/FelixZhu/QBot/pull/12) 的会话首页已经在 `main` 上。

小改直接给布局或交互，不先出图。明显改版出一版图，不做多套候选，也不做完整设计系统。交接写清这次的信息层级、关键交互，以及这次确实需要的状态。空、加载、失败不必每次都画全。

交付前跑一次构建，加上这次改到的核心流程测试，并做敏感信息检查。手机上的触摸、键盘、返回只查这次改到的路径。Designer 用实际预览或截图对一次明显偏差：不像素级，不重复技术验收，不为视觉检查单独做预览。

现有自动回归就在 [`.github/workflows/site-build.yml`](.github/workflows/site-build.yml) 里，本地不需要浏览器的那一组大约几十秒。不要为了省这点时间删掉安全检查或相关回归。要减的是重复交接、审批和无关的手动验收，不改 CI。

样式上的小偏差，以及下面写明的、与本次无关的已知失败，记下来即可。不写成通过，也不挡住试用。没有接通、没有持久化、没有在真机上看过的，必须写明。本地模拟和示例不是真实能力。

按当前这次的授权把体验入口交给 Qian。不因此去对外发布、花钱、改账号或 OSS 或隐私权限、删数据、外发消息。密钥、隐私和数据完整性检查保持。不要提交密钥、令牌、邮箱、密钥库、`*.apk`、`node_modules`、`.expo`、字体或构建产物。

两个工具不要共用一个工作目录：

```bash
git fetch origin main
git worktree add ../QBot-codex -b codex/主题 origin/main
git worktree add ../QBot-claude -b claude/主题 origin/main
```

## 现在能体验

三个 Tab：对话、主动服务、知识库。宽度小于 600px 用底部栏，大于等于 600px 用左侧 72px。对话里打开一条会话时，会藏起这层导航。外壳在 [`apps/drive-web/template.html`](apps/drive-web/template.html)。

- **对话**在 [`apps/chat-web`](apps/chat-web)。打开是会话列表，可以搜索。没有消息时是「还没有会话」和「打开 QBot」。列表只反映这一次打开里已经有的消息，刷新就没了。回复是 `MockBackend`，没有真实后端，也没有把会话存下来。
- **主动服务**是 [`apps/drive-web/feed.js`](apps/drive-web/feed.js)。页面读站点上的 `out/feed.json`。外部文章交给系统浏览器。mp4 / webm 可以内嵌；m3u8、mpd、mkv 不播。本仓库没有生成或上传这份 Feed 的脚本。
- **知识库**是 [`apps/drive-web/kb.js`](apps/drive-web/kb.js)，读 `index.json`。索引打不开时显示错误和「重试」。从查看器返回，或用浏览器后退，回到打开前的列表。`private/` 不进清单。
- 外观跟随系统。导航里没有外观项。以前存下的浅色或深色选择不会再锁住页面。
- 安卓返回键调用网页里的 `qbotBack`。对话里先回到会话列表。网页处理不了时，壳提示「再滑一次退出」。这套壳行为写在已安装的包里，本轮没有用真机复验。

安装包版本看 [`apps/qbot-app/app.json`](apps/qbot-app/app.json) 的 `expo.version` 和 `expo.android.versionCode`。写这份说明时是 `1.0.5` 和 `7`，这版 APK 已经打过。`package.json` 的 `1.0.0` 不是安装包版本。[`eas.json`](apps/qbot-app/eas.json) 的 `appVersionSource` 是 `local`。包名是 `io.github.felixzhu.qiandrive`。网页改动刷新即可，不必为界面重打 APK。

还没有：真实对话后端、会话持久化、原生语音识别、通知、私密区解锁、应用商店包、iOS 构建。GitHub Actions 不打 APK。

`skills/` 不参与网页或 APK。不要跑 `apps/drive-web/sync_modules.sh`，它会从别的目录覆盖现有模块。

## 目录

```
apps/drive-web/    网页外壳、知识库、主动服务、钉死构建
apps/chat-web/     对话 Tab（Vite + React）
apps/qbot-app/     Expo 安卓壳
docs/              视觉参考，以及一份不再当发布步骤的架构说明
.github/workflows/pages.yml       推到 main 时发布 Pages
.github/workflows/site-build.yml  PR 上构建和测试，不发布
```

壳的地址在 [`apps/qbot-app/App.tsx`](apps/qbot-app/App.tsx) 的 `HOME_URL`。网页戳看 [version.json](https://felixzhu.github.io/QBot/version.json)，或跑 `preflight_home.py`。它由 `refresh_site.py` 按页面和 `SHARED_FILES` 计算，只改 `kb.js` / `kb.css` 时可以不变。

## 环境和预览

Actions 使用 Node.js 22 和 Python 3.12。打 APK 需要环境变量 `EXPO_TOKEN`，只放在环境里。上传签名在 Expo 项目 `felixzhu/qian-drive`（`app.json` 的 `owner` / `slug`）。密钥库不在本仓库。日常开发和 Pages 不需要 OSS 凭证；只有不带 `--manifest` 和 `--index` 直接跑 `refresh_site.py` 才会读 `OSS_ACCESS_KEY_ID` 和 `OSS_ACCESS_KEY_SECRET`。

对话 Tab，只看界面和模拟回复：

```bash
cd apps/chat-web
npm ci
npm run dev
```

外壳打开的是已发布的网站，看不到还没发布的网页改动：

```bash
cd apps/qbot-app
npm ci
npx expo start
```

改了返回键、启动页、权限、`HOME_URL` 或包名才升 `app.json` 里的版本，并让 [`apps/drive-web/shell-media.js`](apps/drive-web/shell-media.js) 的 `CAPABILITIES.apk` 与 [`apps/drive-web/shell-media.test.mjs`](apps/drive-web/shell-media.test.mjs) 一致。包名保持 `io.github.felixzhu.qiandrive`。打包前：

```bash
python3 apps/qbot-app/preflight_home.py
cd apps/qbot-app
npx eas-cli@latest build -p android --profile preview --non-interactive
```

`eas.json` 只有 `preview` APK。这条命令使用 Expo 上已有的签名。

## 验证

不需要浏览器的一组（`shell-history.test.mjs` 会 `git show` `0dc920ac`，浅克隆会失败）：

```bash
node --test apps/drive-web/shell-history.test.mjs apps/drive-web/shell-media.test.mjs apps/drive-web/shell-back.test.mjs apps/drive-web/shell-theme.test.mjs apps/drive-web/test/im-home.test.mjs
python3 apps/drive-web/test_accept_site.py
```

需要本机 Chrome 的，是知识库、Feed 返回和本地会话线程：

```bash
node --test apps/drive-web/test/kb.test.mjs
node apps/drive-web/shell-contract.test.mjs
node apps/drive-web/im-thread.browser.mjs
```

一次构建、不发布。对话源码已经和 `apps/drive-web/pins/chat-web.sha256` 不一致（`App.tsx`、`chat.css`、`icons.tsx`），所以这次构建会本地 `npm run build`，其余钉死输入仍从 QBot Pages 下载：

```bash
python3 apps/drive-web/build_pinned.py --repo /tmp/qbot-site
```

`--strict` 仍会按 [`apps/drive-web/pins/live-qbot.sha256`](apps/drive-web/pins/live-qbot.sha256) 把线上文件逐个核对，对不上就退出 `borrowed file hash mismatch`。#12 的 Pages 部署已经成功，部署之后线上的 `chat/chat.css`、`chat/chat.js`、`index.html`、`version.json`、`shell-theme.js` 和这份 pin 不再相同。这是既存失败，与本次文档无关，本 PR 不改 pin。已发布的站点可以继续打开试用。

发布只走 [`.github/workflows/pages.yml`](.github/workflows/pages.yml)：推到 `main` 或手动跑 workflow `pages`，用 `build_pinned.py --strict` 构建，再 `deploy-pages`。构建结果不提交回 git。不要用 `refresh_site.py --push`。不带 `--repo` 时它写到 `/workspace/qian-drive-repo`。`build_pinned.py` 会传入 `--repo`，并且自己拒绝 `--push`。
