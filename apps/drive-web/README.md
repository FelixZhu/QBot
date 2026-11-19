# QBot 网页

外壳、知识库、主动服务和钉死构建的源码。线上地址是 [https://felixzhu.github.io/QBot/](https://felixzhu.github.io/QBot/)。结构和发布方式以仓库根目录 `README.md` 和 `docs/ARCHITECTURE.md` 为准。

```bash
python3 apps/drive-web/build_pinned.py --repo /tmp/qbot-site
python3 apps/drive-web/build_pinned.py --repo /tmp/qbot-site --strict
```

字体有版权，不要提交到这个公开仓库。钉死构建从站点按哈希取回已固定的字体和 Feed 媒体。对话包和页面由这次构建生成，不向站点借用。

知识库是 `kb.js` + `kb.css`。`index.json` 打不开时只显示错误和「重试」，不会画成空目录。`private/` 前缀不进入清单。行为回归不访问对象存储，只用 `test/fixtures/kb-index.json` 里的示例。本机需要 Chrome：

```bash
node --test apps/drive-web/test/kb.test.mjs
```
