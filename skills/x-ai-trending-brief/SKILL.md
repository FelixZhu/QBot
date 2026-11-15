---
name: x-ai-trending-brief
description: >-
  Use this when the user asks for the trending / most popular AI and tech
  articles on X (Twitter), e.g. "X 上最近有什么火的 AI 文章". Produces a Chinese Markdown
  brief via the X plugin. Run only on request.
---
# X 热门 AI 科技文章简报

只在用户主动要求时运行，不要定时跑。

## 准备
1. 先读 X 插件的 `x-api-mcp-guide` 技能（在技能目录里找当前路径），按它的错误处理和成本规则来。
2. 用 GetDynamicTools 找到当前可用的 X 连接命名空间（形如 `user-X` 或 `user-X--<账号>`）。
3. 调 `get_usage_credits` 查余额。预估本次约 0.3 到 0.5 美元；余额不够就停下告诉用户。

## 搜索（总花费上限约 0.6 美元）
价格参考：每条帖子 0.005 美元，每个用户 0.01 美元，每条新闻 0.005 美元。接口可能自动附带用户和被引用帖，它们也计费，所以尽量不要请求 author_id 等 expansions；用户名可以从帖子 `url` 里读出。
1. 英文搜索（`search_posts_all`，start_time 设为过去 48 小时，约 30 条）：
   `(AI OR LLM OR OpenAI OR Anthropic OR Claude OR Gemini OR Grok OR GPU OR startup OR robotics) has:links -is:retweet -is:reply lang:en min_likes:500`
   post.fields 请求 `created_at,public_metrics,author_id,entities`（entities 里有展开链接和标题）。
2. 中文搜索（约 15 条）：用 AI/大模型/科技类关键词 + `has:links -is:retweet -is:reply lang:zh min_likes:200 -注册 -Muse -封号`。
3. `search_news` 搜 AI / technology，最多 10 条（注意这些是 X 用 Grok 写的话题摘要，不是外部媒体链接）。

## 筛选
- 只留指向文章、博客、论文、X 长文或有实质内容的帖子；去掉广告、色情、账号注册/防封技巧、娱乐体育等无关内容。
- 同一事件的多篇报道合并成一条。
- 按点赞+转发+收藏排序，选 10 到 15 篇。

## 输出
写中文 Markdown 文件到 `/workspace/x-briefs/X热门AI科技文章-YYYY-MM-DD.md`（北京时间日期）：
- 标题 + 一句话说明搜索范围和筛选条件
- 「今日必读」3 到 5 篇：标题、@分享者、北京时间、点赞/转发/收藏数、两三句中文概括和为什么值得看、原帖链接和文章链接
- 「其他热门」：每篇一两句
- 「X 新闻热点」：每条一句加链接
- 结尾：读了多少帖子/用户/新闻、按价目估算的花费、剩余额度（再调一次 `get_usage_credits`）

所有数字只能来自真实返回数据。把文件作为附件发给用户，并配几句话说最值得看的三篇和质量上的问题。
