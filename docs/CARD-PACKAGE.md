# 卡片包协议 v1.0

这是给 Qian 确认的方案。导入接口没有实现，Skill 没有创建。写对象和读私人对象都还没有授权。`QBOT_FEED_OPEN` 不能打开这些路径。

`docs/card-package/v1.example.json` 的 digest、hash 和 bytes 是占位，`importable` 为 false，`sample` 为 true。它不能导入，也不能正式发布。`v1.schema.json` 只检查字段形状。形状通过之后，仍要做本文的摘要、HTML、CSP 和 SSRF 检查。

## 版本和未知字段

本修订的读取方只接受 `protocolMajor` 为 1 且 `protocolMinor` 为 0。主版本不是 1，或者次版本不是 0，都拒绝。不把更高的次版本当成向后兼容。

每一层对象都是 `additionalProperties: false`。未知字段拒绝，不忽略。以后若要加字段，另立一次次版本，并写出新的 schema。在那之前，次版本不匹配就是拒绝。

## 目录

```
card-package/
  manifest.json
  cover.png
  work/
    index.html
    assets/...
```

ZIP 只有封面和作品。不画关注、推荐、头像或底栏，也不带可执行脚本。

`files` 必须列出 `cover.png`、`work/index.html` 和每一个资源。规范化路径后，未声明、多余、缺失或重复都拒绝。`..`、绝对路径和符号链接拒绝。

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

`authoringClaim` 只是申报，取值 `human` 或 `bot`。导入审计另行核对，不采用自报。`sample` 为 true 时，dry-run 和 stage 可以做，commit 和 publish 都拒绝。来源或审计记录 `private` 为 true 时，不能整包公开到 OSS 或 Feed。

`cardKey` 在同一个 Bot 下稳定。`contentVersion` 从 1 递增。第一版 `expectedPreviousVersion` 为 null。更新必须等于服务端当前已提交的版本，否则冲突。

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

## 建议接口

下面的路径都没有实现。权限也没有授予。

| 方法 | 路径 | 作用 | 权限 |
| --- | --- | --- | --- |
| POST | `/v1/card-imports/dry-run` | 只检查，不写库，不写对象 | 已认证 owner，且 Bot 在允许列表 |
| POST | `/v1/card-imports/stage` | 检查通过后写入不可变暂存 | 同上，另需尚未授予的对象写权限 |
| POST | `/v1/card-imports/{importId}/commit` | 写入版本行，不改可见指针 | 同上，要求 `expectedPreviousVersion`。`sample` 为 true 时拒绝 |
| POST | `/v1/card-imports/{importId}/publish` | 只改可见指针，不发通知 | 另需发布权限。`sample` 为 true 时拒绝 |
| GET | `/v1/card-imports/{importId}` | 读状态 | 仅该 owner |
| POST | `/v1/card-imports/{importId}/rollback` | 可见指针回到上一版 | 与 publish 相同的权限 |

请求带 `Idempotency-Key` 头，值等于 manifest 里的 `idempotencyKey`。它不是唯一键。commit 和 publish 的正文还要带 `expectedPreviousVersion`。

状态响应建议为：

```json
{
  "importId": "example-import",
  "state": "staged",
  "implemented": false,
  "ownerBound": true,
  "botSlug": "example-bot",
  "cardKey": "example-card-key",
  "contentVersion": 2,
  "contentDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "visibility": "hidden",
  "notification": "not-authorized",
  "sample": true
}
```

`state` 只在 `rejected`、`validated`、`staged`、`committed`、`published`、`rolled-back` 之中。`validated` 是 dry-run 的结果，没有副作用。`staged` 只有暂存对象。`committed` 有版本行，可见指针不动，`visibility` 仍是 `hidden`。`published` 才在一次事务里把可见指针改到这一版。`notification` 在本方案里保持 `not-authorized`，不因为 publish 而发送，通知授权不扩大。

`sample` 为 true 时，commit 和 publish 都拒绝，状态最多到 `staged`。时间用 schema 里的字段：`timezone` 固定 `Asia/Shanghai`；可见窗口是 `visibility.notBefore` 和 `visibility.notAfter`；安静时段是 `notification.quietHours.start` 与 `end`，小时只允许 00 到 23；冷却是 `notification.cooldownMinutes`；通知去重字符串是 `notification.dedupeKey`。过了 `notAfter` 不补发。安静时段内到期的通知不补到时段结束后。跨版本的 `contentDigest` 与当前已公开版相同，则 publish 不把这一版再公开一次。同一版本不靠这个比较放行。

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

hash 已经核对成功的对象不覆盖。同一 hash 再次出现就复用那个对象。hash 不同就使用新的键。commit 只增加不可见的版本行，不改可见指针。publish 才用一次 Postgres 事务把可见指针从上一版改到这一版。这次事务失败就留下没人引用的已核对对象，已发布的行不删，Feed 不变。回滚只在 publish 之后把可见指针改回上一版。

## 安全区

包给出参考画布和 `contentSafe`。参考 inset 只说明那一次排版，不是每台手机的状态栏高度。App 用本机真实 inset，再按卡片宽度缩放。

## 还没做

Skill 没有创建。上面六个路径没有实现。对象写权限、私人读取和通知发送都没有授权。
