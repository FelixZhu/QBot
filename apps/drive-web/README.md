# Qian's Drive 网页

只读网盘页的源码。线上地址：[https://felixzhu.github.io/qian-drive/](https://felixzhu.github.io/qian-drive/)。页面从阿里云 OSS 桶 `qian-grokbot`（`oss-cn-beijing`）列出公共可读文件，不能上传。

部署仓库仍是 GitHub Pages 用的 `FelixZhu/qian-drive`，本目录里的 `refresh_site.py` 默认把生成结果写到 `/workspace/qian-drive-repo`，再按需 `--push`。不要把构建结果推进本仓库。

```bash
# 需要环境变量 OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET（不要写入仓库）
python3 refresh_site.py            # 只生成到 Pages 仓库目录
python3 refresh_site.py --push     # 有改动则提交并推送 Pages 仓库
python3 refresh_site.py --repo DIR # 指定 Pages 仓库路径
```

微软雅黑字体文件有版权，**不要**提交到本公共仓库。字体只保留在 Pages 仓库的 `fonts/` 目录中；模板里按相对路径 `fonts/msyh-subset.woff2` 引用。`refresh_site.py` 用 `copytree(..., dirs_exist_ok=True)` 复制 `assets/`，不会删掉 Pages 仓库里已有的 `fonts/`。

知识库 Tab 是独立模块：`kb.js` + `kb.css`，挂载到页面里的 `#tab-kb`（由 Tab 栏脚本在文件存在时加载）。发布时 `refresh_site.py` 会生成 `index.json`（公开文件的摘要和标签），并把这两个文件拷到 Pages 目录。`private/` 前缀无论 ACL 如何都不会出现在清单里。
