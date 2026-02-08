// Offscreen document for merging video + audio using ffmpeg.wasm

const { FFmpeg } = FFmpegWASM;
let ffmpeg = null;

async function ensureFFmpegLoaded() {
  if (ffmpeg && ffmpeg.loaded) return;
  ffmpeg = new FFmpeg();
  await ffmpeg.load({
    coreURL: chrome.runtime.getURL("ffmpeg/ffmpeg-core.js"),
    wasmURL: chrome.runtime.getURL("ffmpeg/ffmpeg-core.wasm"),
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "mergeVideoAudio") {
    handleMerge(message)
      .then((blobUrl) => sendResponse({ success: true, blobUrl }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function handleMerge({ videoUrl, audioUrl, videoData, audioData }) {
  await ensureFFmpegLoaded();

  let videoUint8, audioUint8;

  if (videoData && audioData) {
    // Mode A: pre-fetched data from content script (Bilibili etc.)
    videoUint8 = new Uint8Array(videoData);
    audioUint8 = new Uint8Array(audioData);
  } else if (videoUrl && audioUrl) {
    // Mode B: fetch directly (non-protected URLs)
    [videoUint8, audioUint8] = await Promise.all([
      fetchAsUint8Array(videoUrl),
      fetchAsUint8Array(audioUrl),
    ]);
  } else {
    throw new Error("缺少视频或音频数据");
  }

  // Write to ffmpeg virtual filesystem
  await ffmpeg.writeFile("input_video.mp4", videoUint8);
  await ffmpeg.writeFile("input_audio.mp4", audioUint8);

  // Remux: copy streams without re-encoding
  await ffmpeg.exec([
    "-i", "input_video.mp4",
    "-i", "input_audio.mp4",
    "-c", "copy",
    "-y",
    "output.mp4",
  ]);

  // Read the output
  const outputData = await ffmpeg.readFile("output.mp4");

  // Clean up virtual filesystem
  await ffmpeg.deleteFile("input_video.mp4");
  await ffmpeg.deleteFile("input_audio.mp4");
  await ffmpeg.deleteFile("output.mp4");

  // Create blob URL
  const blob = new Blob([outputData], { type: "video/mp4" });
  return URL.createObjectURL(blob);
}

async function fetchAsUint8Array(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}
