# QBot App

安卓 App「QBot」的 Expo 源码（SDK 58，React Native 0.88，React 19.3）。当前源码版本：1.0.10（versionCode 12）。已安装的 1.0.9（versionCode 11）没有 `expo-secure-store`，这一版不能 OTA，需要下一版 APK。包名仍是 `io.github.felixzhu.qiandrive`。升级必须用原来的签名。本仓库没有签名文件，也不提交 `EXPO_TOKEN`。

1.0.9 的主动服务先是六课全屏卡片，后面再接 Info、English、Study 三个静态样例账号。底部只有头像、Study Bot 和「关注」，没有右侧按钮，也没有课名。轻点卡片，卡片放大成沉浸页：第 1 课可以看图文、演示视频和本地小游戏，其他课按自己的内容打开。返回或系统返回键缩回原来那张卡。下滑一次只翻一张。问 AI 标「模拟」，视频标「演示」，都不接后端。底栏是图标在上、文字在下。对话首页只有一行 Qbot，点进去就是真实对话，输入框直接在。服务器地址来自发布时的私有配置，不写进仓库。个人试用由服务器显式打开，手机不带令牌。模型密钥只在服务器。知识库仍打开 `https://felixzhu.github.io/QBot/`。不要把网页端的 React 18 装进这个包。界面只用系统字体，不提交字体文件。

同一 `expo.version` 的纯界面改动不用重装。`runtimeVersion` 用 `appVersion`（就是 `expo.version`），preview 构建的 channel 是 `preview`。这一版是 `1.0.10`，因为新增了原生模块 `expo-secure-store`。已安装的 `1.0.9` 不会接收它。下一版 APK 装上之后，同一 `1.0.10` 的 JS 才可以：

```bash
cd apps/qbot-app
npx eas-cli@latest update --channel preview
```

应用启动时在后台检查并下载，下次冷启动再生效，不打断当前这次。检查或下载失败、或者新包启动不起来，就继续用已经装上的包，不弹错误。指纹会把原生配置的细小变化算成新 runtime，界面更新也可能被拒，又得重装；版本号是你自己加的，1.0.10 的包只收 1.0.10 的 JS。本仓库不跑这条发布命令，也不跑 EAS 构建。

## 本地预览

```bash
cd apps/qbot-app
npm install
npm run typecheck
npm test
npx expo start
```

打包前先确认页面已经在线。这一步失败就不要打 APK：

```bash
python3 apps/qbot-app/preflight_home.py
```

确认原生依赖能打成 JS 包（不签名、不上传）：

```bash
cd apps/qbot-app
npx expo export --platform android --output-dir /tmp/qbot-android-export
```

打包正式 APK 需要原来的上传签名。不要把密钥库或打包令牌写进仓库。付费的 EAS 构建不在这一版里触发：

```bash
npx eas-cli@latest build -p android --profile preview --non-interactive --freeze-credentials
```

`eas.json` 使用 `appVersionSource: local`，版本号以 `app.json` 为准。不要把 `node_modules`、`.expo`、APK、日志、密钥库或任何令牌提交上来。
