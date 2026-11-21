# 今日的两张手写卡

App 的今日不再挂六课和三张样例。底栏仍是今日、对话、知识库，打开停在今日。今日里面是「关注」（默认）和「推荐」。

关注列出已关注 bot 看得到的卡，推荐列出公开 bot 的公开卡。两边都按 `published_at` 降序，同一时间再按 id 降序。这不是排序模型。空的时候写「暂时没有新内容」。

Bot 仍是 `agents` 里的一行，没有另建一张 bot 表。这一版种子只保证一个 Qbot：`display_name` 是 Qbot，`visibility` 是 `public`。第一次种子会给当前 `QBOT_OWNER_ID` 写一条关注。取消关注只删这一行，不删会话、消息或卡片。再跑种子不会把关注加回来。推荐里的 Qbot 可以再关注。没关注时，对话页不列出 Qbot，会话仍在数据库里。

两张卡是手写的固定内容，`provenance` 为 `manual`。`authored_at` 是正文写入仓库的时间 `2026-11-21T09:21:18Z`。`published_at` 在第一次种子成功时取数据库时钟，之后不改。

| 卡 | id |
|---|---|
| 三个入口：今日、对话、知识库 | `00000000-0000-4000-8000-0000000000c1` |
| get this over the line | `00000000-0000-4000-8000-0000000000c2` |

报纸那张只说明这个应用的三个入口。旧日报里的数字没有核实，没有写进去。英文那张保留 `get this over the line`，没有音频，也没有跟读打分。封面和页面在 `services/qbot-chat/seed/bundles/`，一共 7 个对象。没有字体文件。

知识库仍打开已发布的库，没有另做服务，也没有改站点钉。已发布的 `index.json` 有 4 条，没有测试夹具里的示例条目，标签里也没有「示例」。App 在页面脚本读索引之前丢掉名称或标签含「示例」的行，其余保留。

## 表

迁移 `004_feed.sql` 只加列和表。`agents` 增加 `display_name`、`visibility`、`bio`。新表是 `follows`、`owner_bootstrap`、`cards`、`artifacts`、`artifact_files`、`artifact_capabilities`。`cards.artifact_id` 指向不可变的 artifact。没有从卡片指回对象存储的公开路径。

## 接口

默认要 `Authorization: Bearer`。`QBOT_PERSONAL_OPEN=1` 只跳过原来的对话和历史，不跳过下面这些。

`QBOT_FEED_OPEN` 保持关闭。没开时，下面的路径是 401。打开以后，没有 bearer 的请求也只能读公开 bot 的公开卡。关注只写配置里的那一个 owner，并且只能指向公开 bot。私有 bot 和仅关注可见的卡不能靠这个开关读到。这个开关不代替对话的 bearer。响应不带 CORS，关注只接受 JSON。

- `GET /v1/feed?scope=following|recommended`
- `GET /v1/bots/by-slug/qbot` 和 `GET /v1/bots/:id`
- `POST` 或 `DELETE /v1/bots/:id/follow`（请求体必须是 `{}`，不能带 owner id）
- `GET /v1/cards/:id`
- `POST /v1/cards/:id/capability`

不能建卡、不能列桶、不能靠这个开关发对话。当前安装包不带登录，也不发送 bearer。开关没开时，今日显示「需要有效的访问令牌」，不会回退到样例卡。

能力是 32 字节的令牌，库存 sha256，十分钟过期，只绑一个 artifact 的一个版本。页面地址是 `/v1/artifacts/:artifactId/v/:version/:token/files/index.html`。相对的 `brief.css`、`mark.svg` 落在同一段路径里。路径多解码一次，拒绝 `..` 和未允许的后缀。响应带 CSP：`connect-src 'none'`、`font-src 'none'`、`frame-ancestors 'none'`。不发 cookie，也不把应用的 bearer 交给页面。WebView 只允许这个目录里的 http(s)。

桶保持私有。公开卡片不会把桶改成公共读，也不会列出别的对象。服务器用环境变量里的 OSS 凭证自己去取。凭证、桶名和签名 URL 不进仓库。本机测试用 `QBOT_OBJECT_ROOT` 指向临时目录，和 OSS 变量不能同时设置。那是 LOCAL 证据，不是线上的桶。

## 发布

锁文件没有变。小主机不要为了这一层再跑 `npm ci`。在已有的 `services/qbot-chat` 目录：

```bash
npm run migrate
QBOT_SEED_CONFIRM=cards npm run seed
npm run seed-keys
```

然后重启进程。`npm run seed-keys` 只打印键和哈希，不上传，也不改桶的 ACL。用现有的上传工具把这 7 个对象放到私有桶的 `qbot/cards/<artifact id>/v1/<file>`。环境变量是 `QBOT_OSS_ENDPOINT`、`QBOT_OSS_BUCKET`、`QBOT_OSS_ACCESS_KEY_ID`、`QBOT_OSS_ACCESS_KEY_SECRET`。前缀必须留在 `qbot/` 下面，默认 `qbot/cards/`。

App 仍是 `1.0.11` / versionCode `13`，`runtimeVersion` 跟 `appVersion`。没有新的原生模块，用的是已经在包里的 WebView。这一层可以 OTA 到已安装的 1.0.11。不要先发 App、后跑种子：新的今日和对话入口会先看到空或 401。

种子和迁移都没有在这台云环境对线上库执行。临时 Postgres 上的集成测试会自己建库、跑完删掉。
