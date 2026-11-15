---
name: aliyun-oss-upload
description: >-
  Use this when a file (video, PDF, report, export, download) should be archived
  to or shared from Qian's Alibaba Cloud OSS bucket, or when the user asks to
  upload/store something to OSS and get a download link.
---
# 阿里云 OSS 归档上传

把整理好的文件上传到 Qian 的阿里云 OSS bucket，按统一目录规则归档，并返回一个限时下载链接。

## 固定配置
- Bucket：`qian-grokbot`，地域：华北2（北京），Endpoint：`https://oss-cn-beijing.aliyuncs.com`
- 凭证：环境变量 `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET`（共享电脑上已设置）。只检查是否存在，**绝不打印、复述或写入文件/聊天**。缺失时用安全卡片（secret request）向用户索取，不要让用户在聊天里明文发。
- 依赖：Python `oss2`（缺失时 `pip install oss2`）。
- Bucket 开启了"阻止公共访问"，对象是私有的，分享一律用签名链接，不要尝试改公共读。

## 目录规则（对象 key 前缀）
| 前缀 | 放什么 |
|---|---|
| `xhs/<笔记id>/` | 小红书下载的视频/图片 |
| `videos/<平台>/` | 其他平台视频，如 `videos/bilibili/` |
| `feishu/export/` | 飞书文档导出（PDF 等） |
| `feishu/<主题>/` | 飞书妙记、会议录像等按主题归档 |
| `docs/` | 单份文档、PDF |
| `reports/` | bot 生成的调研报告 |
| `intake/<YYYY-MM>/` | Information Intake 每月整理的资料 |

不属于以上任何一类时，先问用户放哪，不要自己新建顶层目录。文件名保留原名（中文可以），去掉空格和 `/`，同名时加日期后缀 `_YYYYMMDD`，不要覆盖已有对象（先用 `--check` 确认）。

## 步骤
1. 确认本地文件存在、大小合理；按上表定好对象 key。
2. 运行本目录的脚本：
   ```bash
   python3 <skill目录>/oss_upload.py <本地文件> <对象key> [--days 7] [--check]
   ```
   - 断点续传、自动重试 8 次，大文件或网络慢也能传完；可后台运行（`block_until_ms 0`）。
   - `--check` 只检查对象是否已存在，不上传。
   - 成功后输出最后一行是签名下载链接（默认 7 天有效，最长 7 天）。
3. 回复用户：对象路径（`oss://qian-grokbot/<key>`）、文件大小、下载链接和它的过期时间（按用户时区写明）。签名链接里含临时签名，只发给用户本人，不要写进 skill、记忆或仓库。
4. 如果用户之后要再拿链接，用同一 key 重新签名即可：`python3 oss_upload.py --sign <对象key>`。

## 注意
- 只上传用户要求归档的内容；涉及他人隐私或公司保密资料时先确认。
- 签名链接过期就失效，不要把它当永久链接存档。
