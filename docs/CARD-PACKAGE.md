# 卡片包协议 v1

这是方案，不是已实现的导入接口，也不是 Skill。暂名仍是「QBot 卡片制作」和「QBot 卡片导入」。`docs/card-package/v1.example.json` 的 hash 和 bytes 是占位，`importable` 为 false，不能导入。`v1.schema.json` 只描述字段形状。

读取方只接受 `protocolMajor` 等于 1。0 和 2 都拒绝，不把未知主版本当成兼容。同一主版本里不认识的可选字段可以忽略。

## 目录

```
card-package/
  manifest.json
  cover.png
  work/
    index.html
    assets/...
```

ZIP 只有封面和作品。不画关注、推荐、头像或底栏。默认静态：HTML 不能有脚本、表单、iframe 或远程追踪。CSP 与现有作品页相同：`default-src 'none'`，样式和图片只许 `'self'`。外链必须在 manifest 里逐条声明，并且是 https。未声明的外链拒绝。ZIP 不带可执行脚本。

`files` 必须列出 `cover.png`、`work/index.html` 和每一个资源。规范化路径后，未声明、多余、缺失或重复都拒绝。`..`、绝对路径和符号链接拒绝。

## 谁可以发

manifest 里如果出现 owner，忽略它。认证决定 owner。`botRef.slug` 只是引用，必须落在这个 owner 已允许的 Bot 上，否则拒绝。不能靠公共 Feed 开关打开导入。写对象和读私人对象都还没有授权。

`authoringClaim` 只是申报，取值 `human` 或 `bot`。导入审计另行核对身份，不采用自报结果。审计记录或来源标了 `private: true` 时，不能整包公开到 OSS 或 Feed。公开可见的只是通过审计、且来源本身可公开的封面和作品。

## 同一张卡的后续版本

`cardKey` 在同一个 Bot 下稳定，不随文案变。`contentVersion` 从 1 递增，和作品文件的版本分开记。第一版 `expectedPreviousVersion` 为 null。更新必须等于服务端当前可见版本，否则冲突。

幂等键是 owner、Bot、`cardKey`、`contentVersion`。同一键、同一 manifest digest，重试返回原来的结果。同一键、不同 digest，冲突，不写第二行。数据库用这四元组的唯一约束挡住并发。服务端现在没有这些列，本方案不建表。

## 结论怎么核对

`sources` 可以有多条，每条有地址、取数时刻和新鲜度。`claims` 把一句结论指到来源 id，并给 `work/index.html` 里的原文锚点。正文里碰巧出现同一串字，不算这句结论已经得到来源支持。核对要看到锚点和来源对得上。

## 三步状态

导入、公开可见、通知是三件事。导入成功只表示包收下了，Feed 不变，也不发通知。

公开可见的 `mode` 是 `manual` 或 `schedule`。时间用 `Asia/Shanghai`，`notBefore` 和 `notAfter` 是带时区的绝对时间。过了 `notAfter` 不补发。内容 digest 没变则不改变可见性，也不推送。

通知的 `mode` 默认 `none`。要改成 `schedule` 必须另有通知授权，本方案不授予。去重范围是 owner、Bot、`cardKey`、`contentVersion` 和渠道。`cooldownMinutes` 和 `quietHours` 都按上海时区。安静时段内不补发到时段结束后。

现有系统里，Feed 是否可见由 Postgres 的卡片行决定，作品文件在对象存储。没有现成的通知发送器。通知不能只靠 ZIP 自己实现。

## 安全区

包给出参考画布 `referenceCanvas`（含那一次排版用的 inset）和 `contentSafe`。App 用本机真实 inset 替换参考 inset，再按卡片宽度缩放。不能把参考 inset 的 44 当成每台手机的状态栏高度。缩放后，声明的标题和来源必须落在安全区里，否则这版封面不合格。背景仍铺满卡片，不为了安全区把整张图缩进一块留白。

## 对象存储和数据库

先把文件写到不可变的暂存键。Postgres 一次事务把可见指针从上一版改到这一版。事务失败就留下没人引用的暂存对象，已发布的行不删，Feed 不变。上传中断后，用同一个幂等键重试：暂存不完整就续写，指针没改过就再试一次事务。回滚只把指针改回上一版。

## 还没做

`dry-run`、`stage`、`commit`、`status`、`rollback` 都没有实现。写权限和私人读取也没有授权。
