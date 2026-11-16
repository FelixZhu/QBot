---
name: aliyun-oss-drive
description: >-
  Use this when the user wants to store, archive, upload, list, find, download,
  share, move, rename, delete, restore, or sync files in Qian's Alibaba Cloud
  OSS bucket (their "cloud drive"), asks for a download link to something kept
  there, asks how much space is used, or when another task produced a file
  that should be archived to OSS.
---
# 阿里云 OSS 网盘

把 Qian 的阿里云 OSS bucket 当成网盘用：浏览、上传、下载、整理、回收站、搜索、分享、同步、历史版本。所有操作走本目录的 `oss.py`。

## 固定配置
- Bucket `qian-grokbot`，华北2（北京），Endpoint `https://oss-cn-beijing.aliyuncs.com`。可用环境变量 `OSS_BUCKET`、`OSS_ENDPOINT` 覆盖。
- 凭证：环境变量 `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET`。只检查是否存在，**绝不打印、复述、写入文件或聊天**。缺失时用安全卡片（secret request）向用户索取，不要让用户在聊天里明文发。
- 依赖：Python `oss2`（缺失时 `pip install oss2`）。
- 分享一律用签名链接（最长 7 天）。不要把 bucket 或对象改成公共读。
- 本地状态文件（都在 `~/`，与凭证无关）：`.oss_index.json` 索引/标签，`.oss_shares.json` 分享记录，`.oss_ops.log` 写操作日志，`.oss_resume/` 断点续传缓存。

## 目录规则（对象 key 前缀）
| 前缀 | 放什么 |
|---|---|
| `xhs/<笔记id>/` | 小红书下载的视频/图片 |
| `videos/<平台>/` | 其他平台视频，如 `videos/bilibili/` |
| `feishu/export/` | 飞书文档导出（PDF 等） |
| `feishu/<主题>/` | 飞书妙记、会议录像等按主题归档 |
| `docs/` | 单份文档、PDF |
| `reports/` | 生成的调研报告 |
| `intake/<YYYY-MM>/` | 每月整理的资料 |
| `trash/<YYYY-MM-DD>/<原key>` | 回收站，只由 `rm` 写入，不要手动放东西 |

不属于以上任何一类时先问用户放哪，不要自己新建顶层目录。文件名保留原名（中文可以），去掉空格和 `/`；同名时加 `_YYYYMMDD` 后缀而不是覆盖。

## 命令速查
`O="python3 <skill目录>/oss.py"`；key 可写成 `docs/a.pdf`、`/docs/a.pdf` 或 `oss://qian-grokbot/docs/a.pdf`。以 `/` 结尾或下面有对象的 key 当目录处理。

| 能力 | 命令 |
|---|---|
| 列目录 | `$O ls [prefix] [-r] [--sort name\|size\|time] [--json]` |
| 文件详情 | `$O stat <key> [--json]`（含索引里的标签/摘要） |
| 占用空间 | `$O du [prefix] [--json]`（按下一级目录汇总） |
| 上传 | `$O put <本地文件或目录> <key 或 prefix/> [--overwrite]` |
| 下载 | `$O get <key 或 prefix/> <本地路径> [--overwrite]` |
| 复制/移动/改名 | `$O cp <src> <dst>`、`$O mv <src> <dst> [--overwrite] [--yes]` |
| 新建目录 | `$O mkdir <prefix>` |
| 删除（进回收站） | `$O rm <key 或 prefix> [--yes]` |
| 彻底删除 | `$O rm <key 或 prefix> --purge [--yes]` |
| 回收站 | `$O trash ls [--prefix p]`、`$O trash restore <原key 或 prefix/> [--date YYYY-MM-DD]`、`$O trash empty [--older-than 30] [--prefix p] [--yes]` |
| 搜索 | `$O find [关键词] [--prefix p] [--ext mp4,pdf] [--since/--until YYYY-MM-DD] [--min/--max 10M] [--include-trash] [--json]` |
| 按内容搜 | `$O find --tag 标签... ` / `$O find --text "词 词"`（查本地索引） |
| 索引/打标签 | `$O index rebuild [prefix]`、`$O tag <key> <标签...> [--summary "一句话"] [--replace]` |
| 分享 | `$O share <key> [--days 1-7] [--json]`、`$O share ls` |
| 同步 | `$O sync <本地目录> <prefix> [--direction up\|down\|both] [--dry-run] [--delete] [--yes]` |
| 历史版本 | `$O versions <key>`、`$O restore-version <key> <version_id>` |

退出码：0 成功，1 错误，2 用法错误，3 不存在，4 目标已存在（需 `--overwrite`），5 需确认（`--yes`），6 未开版本控制，7 网络重试后仍失败。

## 常见流程
1. **归档**：按目录规则定 key → `put` → 如用户要链接再 `share` → 归档内容有意义时 `tag` 加标签和一句话摘要，方便以后按内容找。大文件上传用后台运行。
2. **找文件**：先 `find` 关键词/类型/时间；用户描述的是内容（"上个月那个小红书视频"）时用 `find --text` 或 `--tag`。索引为空或过期时先 `index rebuild`（只读，几秒）。
3. **分享**：`share` 输出过期时间和链接。回复用户对象路径、大小、链接和按用户时区写的过期时间。过期后重新 `share` 即可。
4. **同步**：先 `--dry-run` 给用户看计划，再正式执行。`both` 方向按修改时间新者覆盖旧者，两边都改过且分不出新旧的列为 conflicts 不动。`--delete` 删远端时进回收站，删本地是真删。
5. **误删**：`trash ls` 找到 → `trash restore`。回收站不会自动清理，用户要清时用 `trash empty --older-than 30`。

## 规则
- 绝不打印、记录或转述凭证；签名链接只发给用户本人，不要写进 skill、记忆或仓库。
- 以下操作先得到用户明确确认才执行：覆盖已有文件（`--overwrite`）、彻底删除（`--purge`）、清空回收站（`trash empty`）、一次影响超过 20 个对象（`--yes`）、新建顶层目录、`sync --delete`。脚本会在这些情况下拒绝并给出退出码 4 或 5，不要为了绕过而自动加参数。
- `mv` 是先复制、校验大小和 ETag、再删原件；校验失败会保留原件并报错。
- `versions` 报未开启版本控制时如实告诉用户，开启需要在阿里云控制台操作。
- 只归档用户要求的内容；涉及他人隐私或公司保密资料先确认。
