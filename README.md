# QBot - 你的全能助理

QBot 是一款 Chrome 浏览器扩展，集划词查词、中英互查、整句翻译、生词本管理于一体，做你的全能助理。

## Features

- **划词查询**: 选中任意文本，右键或按 T 键即可查询释义
- **中英互查**: 支持英译中、中译英双向查词
- **整句翻译**: 选中整句即可获取翻译
- **发音朗读**: 英式/美式发音一键播放
- **生词本**: 收藏生词，随时回顾管理

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the project directory
5. The extension icon will appear in the toolbar

## Usage

### Right-click lookup
1. Select a word on any webpage
2. Right-click the selection
3. Click **Look up "word"** in the context menu
4. A popup will appear near the word showing its definition

### Direct search
1. Click the QBot extension icon in the toolbar
2. Type a word in the search box
3. Press Enter or click Search

## Tech Stack

- Chrome Extension Manifest V3
- Youdao Dictionary API — 有道词典数据源
- Vanilla JavaScript, HTML, CSS

## Project Structure

```
QBot/
├── manifest.json    # Extension configuration
├── background.js    # Service worker: context menu handling
├── content.js       # Content script: word lookup & popup display
├── content.css      # Styles for the in-page popup
├── popup.html       # Extension toolbar popup UI
├── popup.js         # Toolbar popup logic
├── vocab.html       # Standalone vocabulary page
├── vocab.js         # Vocabulary page logic
└── icons/           # Extension icons (16, 48, 128px)
```

## License

MIT License - see [LICENSE](LICENSE) for details.
