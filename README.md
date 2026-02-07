# QBot - Word Lookup Chrome Extension

A Chrome extension that lets you look up word definitions instantly. Select any word on a webpage, right-click, and choose "Look up" to see its meaning in a clean popup.

## Features

- **Right-click lookup**: Select a word on any webpage, right-click and choose "Look up" from the context menu
- **In-page popup**: Definitions appear in a floating popup right next to the selected word
- **Popup search**: Click the extension icon to manually search for any word
- **Phonetic notation**: Shows pronunciation when available
- **Multiple definitions**: Displays definitions grouped by part of speech, with example sentences

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
- Free Dictionary API (`dictionaryapi.dev`) — no API key required
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
└── icons/           # Extension icons (16, 48, 128px)
```

## License

MIT License - see [LICENSE](LICENSE) for details.
