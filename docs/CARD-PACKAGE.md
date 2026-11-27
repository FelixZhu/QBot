# 卡片包协议 v1.0

本方案已由 Qian 于 2026-11-28 确认；导入接口仍未实现，Skill 没有创建；写对象与读私人对象仍无授权。`QBOT_FEED_OPEN` 与 `QBOT_PERSONAL_OPEN` 都不能打开这些路径。

`docs/card-package/v1.example.json` 的 digest、hash 和 bytes 是占位，`importable` 为 false，`sample` 为 true。它不能导入，也不能正式发布。`v1.schema.json` 只检查字段形状。形状通过之后，仍要做本文的摘要、HTML、CSP 和 SSRF 检查。

## 版本和未知字段

本修订的读取方只接受 `protocolMajor` 为 1 且 `protocolMinor` 为 0。主版本不是 1，或者次版本不是 0，都拒绝。不把更高的次版本当成向后兼容。

每一层对象都是 `additionalProperties: false`。未知字段拒绝，不忽略。以后若要加字段，另立一次次版本，并写出新的 schema。在那之前，次版本不匹配就是拒绝。

## 目录

```
card-package/
  manifest.json
  cover-light.png
  cover-dark.png
  work/
    index.html
    assets/...
```

ZIP 只有封面和作品。不画关注、推荐、头像或底栏，也不带可执行脚本。

`files` 必须列出每一张封面、`work/index.html` 和每一个资源。角色仍只有 schema 里的 `cover`、`page`、`asset`，不新增主题字段。深色封面用路径约定 `cover-dark.png`，浅色用 `cover-light.png`，角色都是 `cover`。只放 `cover.png` 时，两套主题共用这一张图，并且只在两种主题下背景本身都正确、浮层文字对比度也够时才合法。奶油色报纸不能靠深色边条冒充深色版。没有 `cover-dark.png` 又不能合法共用时，深色交付不成立，不能降级成浅图加暗边。

这是尚未实现的 ZIP 约定。当前候选 `9224ed8` 的 App 不按这些文件名选择封面。它只对已发布的两张卡做原生重排，深色报纸是界面画出来的，不是读入第二张图。不要把这份约定说成当前 App 已经支持。

## 两个摘要

`manifestDigest` 不能对含有它自己的 JSON 做哈希。

1. 从根对象删掉 `manifestDigest` 这一个成员。其余成员保留，包括 `contentDigest`。
2. 按 RFC 8785 JCS 生成规范 JSON。
3. 对这份 UTF-8 字节做 SHA-256。
4. 算法名记为 `sha256-jcs`。

服务端自己重算。客户端送来的值只用于核对，对不上就拒绝。

`contentDigest` 是语义内容摘要，只用于跨版本判断要不要再次公开。它按固定键序做成一个对象，再做同样的 JCS SHA-256。只放入：

- `card.title`
- `claims` 的 `id`、`text`、`sourceIds`、`bodyAnchor`
- `files` 的 `path`、`role`、`sha256`、`bytes`、`contentType`（正文和资源的哈希）
- `contentSafe` 与 `referenceCanvas`
- `sources` 的 `id` 和 `url`

明确不放入：`contentVersion`、`expectedPreviousVersion`、`protocolMajor`、`protocolMinor`、`cardKey`、`botRef`、`packageId`、`sample`、`authoringClaim`、`idempotencyKey`、`createdAt`、`card.authoredAt`、`sources.retrievedAt`、`sources.freshUntil`、`sources.private`、`visibility`、`notification`、`manifestDigest`。版本号、记录身份、取数时刻、创作时刻和调度时刻都不进入语义摘要。

来源的 `url` 在里面。同一个 `id` 换成另一个 URL，语义摘要必须改变。`work/index.html` 或其他资源的字节变了，文件哈希就变，语义摘要也变。原文里若嵌了会变的时间，这算内容变，可以接受。

跨两个 `contentVersion` 时，语义摘要相同就不再次公开。同一 `contentVersion` 的重试不靠它放行，见下一节。

## 谁可以发

manifest 里如果出现 owner，忽略它。认证决定 owner。`botRef.slug` 只是引用，必须落在这个 owner 已允许的 Bot 上，否则拒绝。

`idempotencyKey` 只是客户端请求标签。真实唯一键是认证得到的 owner、允许的 Bot、`cardKey`、`contentVersion`。数据库用这四元组做唯一约束。同一版本重试用 `manifestDigest` 严格比较：四元组相同且 `manifestDigest` 相同，返回原来的结果；`manifestDigest` 不同就是冲突，即使 `contentDigest` 没变。新的调度或新的来源申报会改变整包摘要，不能被语义摘要相同放过。相同的 `idempotencyKey` 配上不同的四元组，也是冲突。

`authoringClaim` 只是申报，取值 `human` 或 `bot`。导入审计另行核对，不采用自报。`sample` 为 true 时，可以完成校验与暂存，但不能写入可发布的版本行，也不能进入 `ready`，终态停在 `staged`，publish 拒绝。来源或审计记录 `private` 为 true 时，不能整包公开到 OSS 或 Feed。

`cardKey` 在同一个 Bot 下稳定。`contentVersion` 从 1 递增。第一版 `expectedPreviousVersion` 为 null。更新必须等于服务端当前已有版本，否则冲突。

## 锚点

`bodyAnchor` 有四项：`path` 固定为 `work/index.html`，`elementId`，`fragment`，`quote`。`fragment` 必须等于 `#` 加上同一个 `elementId`。

核对时解析 HTML，不用整篇搜索代替定位：

- 存在且只存在一个 `id` 等于 `elementId` 的元素。
- 该元素在 `body` 里，不在 `script`、`style` 或 `template` 里。
- 把它的文本按空白折叠后，`quote` 必须是其中连续的一段。
- 这句话出现在别的元素里，不算这个锚点成立。
- `claims.text` 必须与 `quote` 相同。
- `sourceIds` 里的每个 id 都必须在 `sources` 里。

正文里碰巧有同一串字，不能单独证明结论。

## 接口约定

下面的路径与异步流程都尚未实现。写对象、读私人对象和发布通知的权限也都没有授予。

| 方法 | 路径 | 作用 | 权限 |
| --- | --- | --- | --- |
| POST | `/v1/card-imports` | 唯一上传入口：浅检查 ZIP 后入队，返回 `202` 与 `importId` | 已认证 owner，且 Bot 在允许列表 |
| GET | `/v1/card-imports/{importId}` | 读导入状态与结果 | 仅该 owner |
| POST | `/v1/card-imports/{importId}/publish` | 单步发布：事务切换可见指针，不发通知 | 另需发布权限。仅 `ready` 可发布；`sample` 为 true 时拒绝 |
| POST | `/v1/card-imports/{importId}/rollback` | 可见指针回到上一版 | 与 publish 相同的权限 |

### 1) `POST /v1/card-imports`

这是唯一的卡片包上传入口。调用方必须是已认证 owner，且目标 Bot 在允许列表内。请求体直接是 ZIP 字节，`Content-Type: application/zip`。

同步阶段只做认证与浅检查：核对 `Content-Type`、压缩后体积上限 8 MiB（可加 ZIP 魔数核对）。不在这个请求里做完整解压、摘要计算、HTML/CSP 或锚点等重检查。浅检查通过后入队，返回 `202`，正文含 `importId` 与 `state: "accepted"`（任务随即进入 `queued`）。

请求带 `Idempotency-Key` 头，作为客户端请求标签（与 manifest 里的 `idempotencyKey` 对应）。上传阶段可能尚未解出 `manifest.json`，入口先按请求头与 ZIP 整包字节哈希处理幂等：

- 同一 `Idempotency-Key` + 相同 ZIP 字节哈希：返回原 `importId`。
- 同一 `Idempotency-Key` + 不同 ZIP 字节哈希，若原任务仍在途（`queued`、`validating`）或已是 `ready`、`published`（以及 `staged`、`rolled-back` 等非 `rejected` 状态）：返回冲突。
- 若原任务已是 `rejected`：释放该 `Idempotency-Key`，允许整包重传，作为新一次尝试。

异步阶段解出 `manifest.json` 之后，仍按上文「谁可以发」中的四元组（owner + 允许的 Bot + `cardKey` + `contentVersion`）与 `manifestDigest` 规则做真正去重与冲突判定。

### 2) 异步流程

任务入队后的流转顺序如下：

`queued` → `validating`（执行解压、限额、schema、摘要、HTML/CSP、外链、锚点、安全区及四元组/版本核对）→ 校验通过后写入不可变暂存对象 → 写入不可见版本行（可见指针不动，`visibility` 仍为 `hidden`）→ `ready`。

- 校验失败：进入 `rejected`，必须记下失败原因；不写最终对象，不写版本行（可以保留 import 记录本身）。
- `sample` 为 true：可以完成校验与不可变暂存，但不能写入可发布的版本行，不能进入 `ready`，终态使用 `staged`；对其调用 publish 一律拒绝。
- 异步流程不自动发布到「今日」。

### 3) `GET /v1/card-imports/{importId}`

仅该 owner 可读。持久状态只允许 `queued`、`validating`、`staged`、`ready`、`rejected`、`published`、`rolled-back` 七种。`accepted` 只出现在 `POST /v1/card-imports` 的 `202` 响应里，随即进入 `queued`，不作为 `GET` 的持久状态。

`rejected` 状态必须带上失败原因（如 `reason`）。响应还包含 `botSlug`、`cardKey`、`contentVersion`、`contentDigest`、`manifestDigest`、`sample`、`publishAllowed`、`visibility`、`notification`（固定保持 `not-authorized`）。在任务尚未解出 manifest 之前，对应字段可为 `null`。以下为 `ready` 状态下的响应形状示例（仅作方案约定，接口尚未实现）：

```json
{
  "importId": "example-import",
  "state": "ready",
  "ownerBound": true,
  "botSlug": "example-bot",
  "cardKey": "example-card-key",
  "contentVersion": 2,
  "manifestDigest": "0000000000000000000000000000000000000000000000000000000000000000",
  "contentDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "sample": false,
  "publishAllowed": true,
  "visibility": "hidden",
  "notification": "not-authorized"
}
```

### 4) `POST /v1/card-imports/{importId}/publish`

单独一步，需要发布权限。只有 `ready` 状态可以发布。请求正文带 `expectedPreviousVersion`（第一版为 `null`）。`sample` 为 true 时拒绝。

时间用 schema 里的字段：`timezone` 固定 `Asia/Shanghai`；可见窗口是 `visibility.notBefore` 和 `visibility.notAfter`；安静时段是 `notification.quietHours.start` 与 `end`，小时只允许 00 到 23；冷却是 `notification.cooldownMinutes`；通知去重字符串是 `notification.dedupeKey`。过了 `notAfter` 不补发。安静时段内到期的通知不补到时段结束后。跨版本的 `contentDigest` 与当前已公开版相同，则 publish 不把这一版再公开一次。同一版本不靠这个比较放行。

publish 在一次事务里把可见指针切到这一版，失败不改已发布行和 Feed。`notification` 在本方案里保持 `not-authorized`，不因为 publish 而发送，通知授权不扩大。

### 5) `POST /v1/card-imports/{importId}/rollback`

与 publish 同权，仅在 publish 之后把可见指针改回上一版，状态变为 `rolled-back`。

## 与现有 `POST /v1/cards` 的关系

- `POST /v1/cards` 是已实现的同步 JSON + 内嵌 Base64 发卡路径，线上仍因 OSS 写入凭证未接通而可能返回 `503 storage_readonly`。
- 不要把 ZIP 导入塞进 `POST /v1/cards`。
- 正式制作路径将是本导入 API（`POST /v1/card-imports` 及上述异步/发布流程）；`POST /v1/cards` 作为过渡路径保留，本次不删。
- 异步暂存与入库上线仍依赖 OSS 写入凭证，本方案修订不解决这一点，也不授予对象写权限。

## 方案中的限额

这些数字是方案值，不是已生效的配置。

| 项 | 方案值 |
| --- | --- |
| ZIP 压缩后 | 8 MiB |
| 解压后合计 | 32 MiB |
| 单文件解压后 | 8 MiB |
| 文件个数 | 32 |
| 压缩比上限 | 100 比 1 |
| 路径长度 | 128 |
| HTML 元素个数 | 2000 |

HTML 解析后还要拒绝 `script`、`iframe`、`object`、`embed`、`form`、事件属性和 `javascript:` 地址。CSP 仍是 `default-src 'none'`，样式和图片只许 `'self'`。外链必须事先逐条声明，并且是 https。这些检查不因为 schema 通过而跳过。

本方案的导入不抓取 `source.url`。制作者负责核实来源并提供证据。导入的自动检查只核对结构、摘要、锚点、类型和限额，不宣称因此证明内容为真。正式公开前要有人工审查，公开文件还要有隐私审批。schema 通过不等于鉴权，也不等于真实性验证。若以后增加抓取，必须拒绝非 https、内网地址，以及重定向到这些地址。

## 暂存

暂存对象在校验完成之前不是最终对象。上传中断时中止未完成的 multipart，不在同一个未完成对象上继续追加。重传是整份字节重新上传，传完再按 hash 核对。

hash 已经核对成功的对象不覆盖。同一 hash 再次出现就复用那个对象。hash 不同就使用新的键。异步校验通过后写入不可变暂存对象，并写入不可见的版本行，不改可见指针（`visibility` 仍为 `hidden`）；`sample` 为 true 时不写可发布版本行，终态停在 `staged`。publish 才用一次 Postgres 事务把可见指针从上一版改到这一版。这次事务失败就留下没人引用的已核对对象，已发布的行不删，Feed 不变。回滚只在 publish 之后把可见指针改回上一版。

## 安全区

背景铺满参考画布，再铺满卡片。`contentSafe` 只框关键标题、结论和来源，不是把整张图缩进这块矩形。

参考画布上的一张图，放到设备上时按「铺满后裁切」缩放：比例取卡片宽除以图宽、卡片高除以图高里较大的那个，居中，多出来的边裁掉。卡片高度已经去掉原生底栏和底部 inset。顶部叠层是本机状态栏 inset，加上关注/推荐切换的高度，再加 16dp。底部叠层是原生署名行的高度再加 16dp。这些数来自本机布局，不写死成某一台手机的坐标。

窄屏更高，多半裁左右。折叠展开后卡片更宽更矮，多半裁上下。上下裁切会碰到标题。把 `contentSafe` 按同一套缩放映射到设备上，映射后的矩形必须整个落在没被裁掉的区域里，并且落在两条叠层之间。落进去才算关键文字不遮、不裁。静态图自己不会随 inset 或长宽比挪字。检查失败就拒绝这张封面，不能声称它天然适配。

没有主题字段时，同一份 `contentSafe` 同时约束浅色图和深色图。两张图的关键文字必须落在同一块安全区里。若两套版式的安全区不同，v1 表达不了，这是待实现的限制，不是已经支持。

## 字体和音频

中文优先用系统里的微软雅黑，不把没有授权的字体打进包。有合法授权的字体可以放进 `files`，角色为 `asset`，并在来源里写明授权出处。没有授权核实就不收。

封面是静态图，没有播放交互。作品里不能画可点的波形，也不能把没有音频的装饰说成能播放。本方案的 CSP 是 `default-src 'none'`，没有放开 `media-src`。真实音频要等容器和 CSP 都实际允许，并且单独验证之后才可以出现。这一版不表示已经允许。

## 还没做

Skill 没有创建。上述接口与异步流程都未实现；对象写权限、私人读取和通知发送都未授权。
