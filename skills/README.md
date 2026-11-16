# Grok Bot Skills

这里收录了 Qian 在 Grok Bot 里自建的 skills。每个文件夹是一个 skill（`SKILL.md` 加辅助文件），并带一份中文 [README](./README.md) 介绍它做什么，以及关键的设计与技术实现。

| Skill | 说明 |
|---|---|
| [`aliyun-oss-drive`](./aliyun-oss-drive/README.md) | 按统一目录规则把文件归档到阿里云 OSS（qian-grokbot），返回限时下载链接 |
| [`cute-animated-avatar`](./cute-animated-avatar/README.md) | 为 Bot 制作毛绒风格、适合圆形裁切的循环 GIF 头像（眨眼 + 标志动作） |
| [`remotion-best-practices`](./remotion-best-practices/README.md) | 所有 Remotion 技能的路由器：按任务加载子技能，默认先开 Studio 预览 |
| [`remotion-captions`](./remotion-captions/README.md) | 用 Whisper 转写或导入 SRT，并在时间轴上与镜头同步显示字幕 |
| [`remotion-create`](./remotion-create/README.md) | 脚手架新的 Remotion 项目，并按视频排版规范开始写画面 |
| [`remotion-markup`](./remotion-markup/README.md) | Remotion React 标记、动画、特效与媒体的实践指南 |
| [`remotion-render`](./remotion-render/README.md) | 导出 Remotion 视频、静帧，以及带透明通道的成片 |
| [`remotion-studio`](./remotion-studio/README.md) | 启动并保持 Remotion Studio 预览，方便边改边看 |
| [`remotion-video`](./remotion-video/README.md) | 用 Remotion + MiniMax/Edge TTS 做音频驱动的教程或 3D 视频 |
| [`x-ai-trending-brief`](./x-ai-trending-brief/README.md) | 按需检索 X 上热门的 AI / 科技文章，整理成中文简报 |
| [`xiaohongshu-download`](./xiaohongshu-download/README.md) | 从小红书分享链接下载笔记视频或图片，仅供个人离线使用 |
