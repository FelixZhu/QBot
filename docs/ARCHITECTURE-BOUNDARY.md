# QBot 架构边界

本文描述 `main` `dfe6653156bdeb267c61af376fc99eb802a086de` 上已经落地的代码，以及尚未实施的目标。目标是待评审设计，不是现状。目录草案没有落地。本文不改业务、不发布、不删除文件。

状态只用这三种：

- **已实现**：该提交里能直接读到的代码或测试。
- **过渡依赖**：构建或运行仍然借用仓库外的公开字节或另一条分支，退出条件未满足。
- **待实施**：建议中的边界或迁移，仓库里还没有对应结构。

## 1. 目录

已实现的源码布局：

```
apps/qbot-app/          原生壳（Expo WebView）
apps/chat-web/          对话源码，Vite 构建
apps/drive-web/         网页壳、Feed、知识库、共享样式、构建入口
  template.html         唯一页面模板。refresh_site.py 只读这个文件
  template_v1.html      存在，没有任何引用，不是构建输入
  feed.js feed.css
  kb.js kb.css
  shell-media.js shell-theme.js
  tokens.css layout.css components.css
  build_pinned.py accept_site.py refresh_site.py
  pins/                 公开字节的 SHA256，不是那些字节本身
docs/ARCHITECTURE.md    较早的说明，不替代本文的现状/目标区分
docs/DESIGN.md
```

`refresh_site.py` 的 `SHARED_FILES` 是 `tokens.css`、`layout.css`、`components.css`、`feed.js`、`feed.css`、`shell-media.js`、`shell-theme.js`。`kb.js` 和 `kb.css` 另外复制。版本哈希不包含 `kb.js`、字体和图标。

待实施的目录草案（未创建）：把「导航调度」「Feed 展示」「策略」「知识库」「共享组件」拆成独立目录，并由构建只从这些目录取源。现在它们仍平铺在 `apps/drive-web/`。`sync_modules.sh` 仍会从 `kb-tab` 或外部工作树拷贝模块，这是旧的拼装方式，不是目标布局。

## 2. 职责与状态

| 层 | 已实现的所有者 | 独占状态 | 显式接口 | 不拥有 |
|---|---|---|---|---|
| 原生壳 `apps/qbot-app/App.tsx` | 系统返回、WebView、站外顶层导航 | 加载中的 URL、退出计时 | 注入 `qbotBack()`；`Linking.openURL` | Tab、卡片、搜索。不读 Feed 或知识库内部状态 |
| 网页导航 `template.html` | Tab、历史、返回调度、浮层关闭 | 当前 Tab（`sessionStorage` `qbs_tab`）、`skipFeedHome` | `qbotBack`、`qbotTab`、`qbot:tab`、`closeShellOverlay` | 卡片序号、检索词、会话列表 |
| 对话 `apps/chat-web` | 会话与抽屉 | 抽屉、模拟回复模式 | `qbotChat.back()`；`ChatBackend.reply` | Feed、知识库。真实后端未接，现为 `MockBackend` |
| Feed `feed.js` | 卡片流 | 卡片数据、当前位置、卡内滚动、详情、菜单、弹层、静音和稍后 | `QbotFeed.mount/unmount/back/closeDetail` | Tab 栏。静音键 `qbot-feed-muted-types`，稍后键 `qbot-feed-snoozed`，只在本机 |
| 壳媒体 `shell-media.js` | 站内文章/视频浮层 | 浮层开关 | `qbotShell.openArticle/openExternal/isOpen/close` | Feed 的卡片列表 |
| 知识库 `kb.js` | 检索与目录 | 搜索词、标签、当前目录、选中文件、弹层 | `qbotKb.back/open`，`KB.mount/boot` | 索引的生产。索引进来自 `index.json` |
| 主题与共享样式 | `shell-theme.js` 管外观；三份 CSS 是变量和基础组件 | `localStorage` `qd2_theme`（light / dark / auto） | `QbotShellTheme.mount` | Feed 和知识库只消费变量，不保存主题 |
| 数据与发布 | `refresh_site.py` 组装；`build_pinned.py` 是钉死输入的构建入口；`accept_site.py` 做严格比对 | 无运行时业务状态 | 见第 5 节 | 不写 OSS |

依赖只向下。导航调用模块已导出的 `back` / `closeDetail`。Feed 在有 `qbotShell` 时调用 `openArticle` / `openExternal`，没有壳时自己展示说明。Feed 不引用知识库实现；文件卡若要打开知识库，走导航注入的 `qbotKb.open`，该函数不存在则只切 Tab。知识库 `open` 再调 `qbotTab("kb")`，不读 Feed 的内部状态。

待实施：原生只保留系统能力和 WebView 桥，业务模块不互改 DOM；策略（触发、排序、去重、推送）与 Feed 展示分开。这些拆分没有落地。本轮不新增策略，不改字段、对象键编码或上述存储键。

## 3. closeDetail 与 back()

这是两份契约，不能从其中一份推导另一份。

`closeDetail` 已实现：只清自己的 `state.detail` 和 `.feed-detail`，恢复打开详情前的卡片位置，没有详情时返回 false，有详情时返回 true。函数体不调用 `shell.close`。重复调用在没有详情时是空操作。

`back()` 已实现，并且仍是公开兼容入口。`feed.js` 头部写明顺序：先关详情，再关菜单，再关弹层，再回到第一张卡，否则返回 false。导航在 Feed 层（菜单、弹层、详情类名）上调用 `qbotFeed.back()`。浮层打开时，导航走 `closeShellOverlay`，不走 `qbotFeed.back()`。`closeShellOverlay` 先调 `closeDetail()`，若壳仍开着再由壳自己 `shell.close()`。

`feed-redesign.mjs` 里「`back()` 应调用 `shell.close`」的断言与上述契约相反。`156687b` 和合仓头上该测试都以退出码 1 失败，日志只差临时端口。该断言没有删除，也没有放宽。`shell-back.test.mjs` 里的假 `closeDetail` 会自己调用 `shell.close`，不能当作真实 `feed.js` 的证明。真实路径由 `shell-contract.test.mjs` 加载仓库里的 `feed.js` 和模板中的 `closeShellOverlay` 原文。

## 4. 改哪里、测哪里

| 需求 | 改动位置 | 先跑 |
|---|---|---|
| 卡片展示、静音、稍后 | `feed.js` 现有状态 | `test/feed-redesign.mjs`（含一条仍失败的断言）、`shell-contract.test.mjs` |
| 浮层开关与站外地址 | `shell-media.js`；调度在 `template.html` | `shell-media.test.mjs`、`shell-contract.test.mjs`、`shell-reentry.browser.mjs` |
| 返回先关谁 | `template.html` 的 `qbotBack` / `closeShellOverlay` | `shell-back.test.mjs`、`shell-history.test.mjs`、reentry |
| 搜索、筛选、目录、打开文件 | `kb.js` | `test/kb.test.mjs` |
| 外观 | `shell-theme.js`；颜色才动 `tokens.css` | `shell-theme.test.mjs` |
| 换对话后端 | `apps/chat-web` 的 `ChatBackend` 实现 | 对话界面。不改 Feed |
| 只换网页资源 | 源码模块后跑构建 | 第 5 节。不手改 `qian-drive` |
| 壳打开的地址 | `App.tsx` 的 `HOME_URL` | 必须新 APK。本次不打包 |

## 5. 构建、借用与退出

已实现的命令：

```bash
python3 apps/drive-web/build_pinned.py --repo /tmp/qbot-site
python3 apps/drive-web/build_pinned.py --repo /tmp/qbot-site --strict
```

普通构建记录差异后仍退出 0。`--strict` 对缺文件、多文件，以及版本戳以外的字节差异失败。`index.html` 只把实际版本戳换成占位符再比，不整文件放过。`version.json` 只允许 `"version"` 字段不同。

过渡依赖，写在 `apps/drive-web/pins/inputs.sha256` 开头：字体两份、feed 媒体、已发布的 `chat.js`/`chat.css`、`manifest.json`、`index.json` 的字节不在本仓库，构建从 `https://felixzhu.github.io/qian-drive/` 的 `20916f6` 按哈希拉取。聊天源码与 `pins/chat-web.sha256` 一致时复用该已发布包，不重新跑 Vite。这不是完全独立构建。

完整性：拉取后 SHA256 必须与钉一致，否则构建失败。`--strict` 再要求产物里的清单、manifest 和媒体与钉相同。

退出硬门，全部满足之前不移除这个来源，也不删除旧库：

1. 这些字节有仓库外的归档，并能按同一份 SHA256 取回。
2. 构建改用该归档，`--strict` 仍通过。
3. 新地址上的浏览器回归通过。
4. 已安装的新 APK 能打开新地址。
5. 仍使用旧包的人已知旧地址将消失。

`refresh_site.py` 默认仍会只读列举 OSS 桶 `qian-grokbot` 并写到 `/workspace/qian-drive-repo`。钉死路径不读凭证、不写桶。合仓没有移动或删除 OSS 对象，也没有改公开范围。知识库索引的目标生成方式是：读取 OSS 元数据，生成公开 `index.json` 与 manifest，浏览器打开时不再带凭证。该 OSS 路径仍是脚本里的默认实现；当前 CI 用的是已钉死的公开副本，不是现列举。

## 6. 迁移顺序

待实施，一步没做完不能做下一步。禁止只迁一半调用方再回退接口。

1. 固定基线：源码 `dfe6653`，钉死的公开输入，视口 390 和 840，以及第 4 节的测试动作。
2. 抽接口时保留旧函数可用。适配层只转发，不改状态键和字段。
3. 逐个调用方改到新接口。每改一处都跑该调用方的测试。
4. 全部调用方迁完后，对同一整套构建产物做回归。
5. 第 5 节的退出硬门都满足后，才移除旧入口。

覆盖：有壳与无壳、连续返回、回到原卡原位置、视频暂停、主题、文件打开与返回、索引和 manifest 与钉一致。网页通过不代替 Android WebView、已装 APK 和系统返回键。

每步可单独回退为撤掉该步提交。线上回滚点仍是旧站 `20916f6` / `0cb21751c930`，直到旧库按硬门退役。退役之后旧 URL 不能再当回滚目标。

## 7. 旧地址、APK 与退役

已实现且硬编码：`App.tsx` 的 `HOME_URL` 为 `https://felixzhu.github.io/qian-drive/`，`HOME_PATH` 为 `/qian-drive`。`shell-media.js` 的 `isShellPage` 只承认这个 host 和这条路径。`package.json` 没有 `expo-updates`。`app.json` 为 1.0.4，`versionCode` 6。已安装包不能靠刷新改地址。

待实施的门：

- 改 URL 时递增 `versionCode`，并单独发 APK。本次不打包，不产生 EAS 费用。
- Android 真机验收与网页回归分开。网页 390/840 通过不关闭这个门。
- 旧库退役只在第 5 节硬门之后。本次不删除、不归档 `qian-drive`，不改 Pages。

## 8. 合仓验收里已经有的证据

相对线上 27 个文件，连续两次构建 SHA256 全相同。25 个与 `20916f6` 相同。不同的只有 `index.html` 的版本戳和 `version.json` 的 `version`。构建戳是 `ee9e5a76615e`，`generated` 仍是 `1794940523`。按当前哈希顺序重算已发布字节，得到 `ee9e5a76615e`，得不到 `0cb21751c930`。戳不同不证明行为变了。

`--strict` 与 `test_accept_site.py` 已在 CI `44225497378` 通过。负例包括 HTML 戳以外的篡改、`generated` 被改、Feed 字节被改、缺文件、多文件。知识库 `test/kb.test.mjs` 9 项通过并已进 CI。`shell-reentry.browser.mjs` 对构建产物 62 通过、0 失败。公开索引的一条对象做过 `Range: bytes=0-0`，返回 206，类型为视频；对象键没有写入文档或源码说明。

## 9. 尚未闭环

- `feed-redesign.mjs` 那条要求 `back()` 调用 `shell.close` 的断言仍失败。失败日志保留。不能删断言来显示全绿，也不能改 Feed 行为去凑绿。
- `shell-back.test.mjs` 的假 `closeDetail` 仍会调用 `shell.close`。它只说明模板的调用形状，不证明真实实现。
- `template_v1.html` 在 `main` 上，约 33 KB。全仓库没有引用。`refresh_site.py` 只读 `template.html`，所以它不是构建输入。`ix-fixes` 的 `106db09` 和 `kb-tab` 的 `91b5939` 写过删除它，这两个提交都不是 `main` 的祖先。本文不删除该文件。
- 未并入 `main` 的侧枝包括 `feat/ui`、`chat-demo`、`ix-fixes`、`kb-tab`。它们不是当前架构，也不在本 PR 实施。
- 安卓 WebView、已装 APK、系统返回键未测。
- 新 Pages、换 URL、退役旧库未做。
