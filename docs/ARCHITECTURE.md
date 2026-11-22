# QBot 代码架构

结论：源码只在 [FelixZhu/QBot](https://github.com/FelixZhu/QBot)。站点是 [https://felixzhu.github.io/QBot/](https://felixzhu.github.io/QBot/)。`FelixZhu/qian-drive` 已删除，构建不再向它取文件。本文描述 `main` `e02e18f` 上已经落地的边界。协作和验收以仓库根目录 `README.md` 为准。`docs/DESIGN.md` 的尺寸是实现参考，不是像素级合同。

状态只用这两种：

- **已实现**：该提交里能直接读到的代码或测试。
- **未落地**：仓库里还没有对应结构，或还没有在真机上复验。

## 1. 目录

已实现的源码布局：

```
apps/qbot-app/          原生壳（Expo WebView）
apps/chat-web/          对话源码，Vite 构建
apps/drive-web/         网页壳、Feed、知识库、共享样式、构建入口
  template.html         页面模板。refresh_site.py 只读这个文件
  template_v1.html      存在，仓库内没有引用，不是构建输入
  feed.js feed.css
  kb.js kb.css
  shell-media.js shell-theme.js
  tokens.css layout.css components.css
  build_pinned.py accept_site.py refresh_site.py
  pins/                 公开字节的 SHA256，不是那些字节本身
docs/DESIGN.md          视觉参考
```

`refresh_site.py` 的共享文件是 `tokens.css`、`layout.css`、`components.css`、`feed.js`、`feed.css`、`shell-media.js`、`shell-theme.js`。`kb.js` 和 `kb.css` 另外复制。

导航、Feed、知识库和共享样式仍平铺在 `apps/drive-web/`。拆成独立目录、把策略和展示分开，都还没有做。`sync_modules.sh` 会从别的目录覆盖模块，不要跑。

## 2. 职责

| 层 | 已实现的所有者 | 显式接口 | 不拥有 |
|---|---|---|---|
| 原生壳 `apps/qbot-app/App.tsx` | 系统返回、WebView、站外顶层导航 | 注入 `qbotBack()`；`HOME_URL` 为 `https://felixzhu.github.io/QBot/`，`HOME_PATH` 为 `/QBot` | Tab、卡片、搜索。不读 Feed 或知识库内部状态 |
| 网页导航 `template.html` | Tab、历史、返回调度、浮层关闭 | `qbotBack`、`qbotTab`、`qbot:tab`、`closeShellOverlay`。当前 Tab 记在 `sessionStorage` 的 `qbs_tab` | 卡片序号、检索词、会话列表 |
| 对话 `apps/chat-web` | 会话列表和演示回复 | `qbotChat.back()` 先回到列表 | Feed、知识库。没有真实后端，新消息不持久 |
| Feed `feed.js` | 卡片流 | `QbotFeed.mount/unmount/back/closeDetail`。数据来自站点 `out/feed.json` | Tab 栏。静音和稍后只在本机 |
| 壳媒体 `shell-media.js` | 站内文章/视频浮层 | `qbotShell.openArticle/openExternal/isOpen/close`。`isShellPage` 只承认这个 host 和 `/QBot` | Feed 的卡片列表 |
| 知识库 `kb.js` | 检索与目录 | `qbotKb.back/open`。索引进来自 `index.json`。`#/` 是库根 | 索引的生产 |
| 主题 `shell-theme.js` | 跟随系统外观 | `QbotShellTheme.mount`。`data-theme` 是解析后的 light 或 dark，`data-theme-mode` 保持 `auto` | 导航里的外观项。旧的手动选择不再锁住页面 |
| 构建 | `build_pinned.py` 拉取并核对借用输入，再跑 `refresh_site.py`；`accept_site.py` 做严格比对 | 见第 4 节 | 不发布，不写对象存储 |

依赖只向下。导航调用模块已导出的 `back` / `closeDetail`。Feed 在有 `qbotShell` 时调用 `openArticle` / `openExternal`。文件卡若要打开知识库，走导航注入的 `qbotKb.open`，该函数不存在则只切 Tab。

`apps/qbot-app/app.json` 里安装包版本是 `1.0.10`，`versionCode` 是 `12`。`1.0.10` 新增 `expo-secure-store`，`runtimeVersion` 仍跟 `expo.version`，所以已安装的 `1.0.9` 不能靠 OTA 收到这一版。`package.json` 的 `1.0.0` 不是安装包版本。包名是 `io.github.felixzhu.qiandrive`。`runtimeVersion` 策略是 `appVersion`。preview 构建写入 channel `preview`。同一版本的 JS 用 `eas update --channel preview` 发布，启动时后台下载，下次冷启动生效；失败保持已安装的包。原生依赖变了要升 `expo.version` 再发 APK。这一轮不在这里打包，也不发布更新。

## 3. closeDetail 与 back()

这是两份契约。

`closeDetail` 已实现：只清自己的详情和 `.feed-detail`，恢复打开详情前的卡片位置。没有详情时返回 false，有详情时返回 true。函数体不调用 `shell.close`。

`back()` 已实现。`feed.js` 的顺序是：先关详情，再关菜单，再关弹层，再回到第一张卡，否则返回 false。导航在 Feed 的菜单、弹层、详情上调用 `qbotFeed.back()`。浮层打开时，导航走 `closeShellOverlay`：先调 `closeDetail()`，若壳仍开着再由壳自己 `shell.close()`。关浮层这一下不把卡片滚回第一张；下一下回到对话。

`apps/drive-web/test/feed-redesign.mjs` 里仍有一条期望：`back()` 调用 `qbotShell.close` 并留在当前卡。这和上面的实现不一致。该断言没有删除，也没有放宽。`shell-contract.test.mjs` 加载仓库里的 `feed.js`，并检查 `closeDetail` 不调用 `shell.close`。`shell-history.test.mjs` 会 `git show` `0dc920ac`，浅克隆会失败。

## 4. 构建与借用

已实现的命令：

```bash
python3 apps/drive-web/build_pinned.py --repo /tmp/qbot-site
python3 apps/drive-web/build_pinned.py --repo /tmp/qbot-site --strict
```

普通构建记录差异后仍退出 0。`--strict` 对缺文件、多文件，以及白名单以外的字节差异失败。

借用输入写在 `apps/drive-web/pins/inputs.sha256`：字体两份、Feed 媒体、`manifest.json`、`index.json`。构建从 `https://felixzhu.github.io/QBot/` 按哈希拉取，不一致就退出 `pin mismatch`。这些字节不在本仓库。

`chat/chat.js`、`chat/chat.css`、`index.html`、`version.json` 由这次构建生成。严格检查要求它们非空，并且来自当前的对话构建和 `template.html`。它们不在借用钉里，也不再与上一版线上字节比对。`apps/drive-web/pins/chat-web.sha256` 只记录对话源码指纹；对不上时构建仍从 `apps/chat-web` 重新打包，不因此失败。

`apps/drive-web/pins/live-qbot.sha256` 仍核对站点上其余公开文件，包括从本仓库复制出去的壳文件。2026-11-19 逐项下载后，这份钉和 `inputs.sha256` 里的每个借用文件都与站点字节一致，因此没有改哈希。校验没有删除，也没有放宽。

发布只走 `.github/workflows/pages.yml`：推到 `main` 或手动跑 workflow `pages`，用 `build_pinned.py --strict` 构建后再部署。构建结果不提交回 git。`build_pinned.py` 拒绝 `--push`。不带清单和索引直接跑 `refresh_site.py` 才会列举对象存储；钉死路径不读凭证。

## 5. 改哪里、测哪里

| 需求 | 改动位置 | 先跑 |
|---|---|---|
| 卡片展示、静音、稍后 | `feed.js` | `shell-contract.test.mjs` |
| 浮层开关与站外地址 | `shell-media.js`；调度在 `template.html` | `shell-media.test.mjs`、`shell-contract.test.mjs` |
| 返回先关谁 | `template.html` 的 `qbotBack` / `closeShellOverlay` | `shell-back.test.mjs`、`shell-history.test.mjs` |
| 搜索、筛选、目录、打开文件 | `kb.js` | `test/kb.test.mjs` |
| 外观 | `shell-theme.js`；颜色才动 `tokens.css` | `shell-theme.test.mjs` |
| 换对话后端 | `apps/chat-web` | 对话界面。不改 Feed |
| 只换网页资源 | 源码模块后跑第 4 节 | 不改钉的校验方式 |
| 壳打开的地址 | `App.tsx` 的 `HOME_URL` | 必须新 APK。本次不打包 |

## 6. 尚未落地

- 原生对话的服务器在 `services/qbot-chat`：一个进程、一份 agent 定义、每次交互或以后的后台产物各记一条 run。网页 `apps/chat-web` 仍是演示。还没有工具、定时卡片、通知、私密区解锁、应用商店包、iOS 构建。
- 目录拆分，以及策略（触发、排序、去重、推送）与 Feed 展示分开。
- `template_v1.html` 仍在仓库里，没有引用。本文不删除它。
- 安卓 WebView、已装 APK、系统返回键本轮没有复验。网页通过不代替真机。
- GitHub Actions 不打 APK。
