/**
 * Voice input seam. The demo only tries the browser's Web Speech API, which
 * Android System WebView does not support; the real path is a native
 * recognizer in the Expo shell bridged in over postMessage (see the
 * tech-selection doc). Until then the mic shows a "coming soon" toast.
 */
export interface VoiceSession {
  stop(): void;
  cancel(): void;
}
export interface VoiceInput {
  available(): boolean;
  start(handlers: { onText(text: string): void; onError(reason: string): void; onEnd(): void }): VoiceSession;
}

type SR = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

function ctor(): (new () => SR) | undefined {
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

function inAndroidWebView(): boolean {
  return /; wv\)/.test(navigator.userAgent) || "ReactNativeWebView" in window;
}

export const webSpeechVoice: VoiceInput = {
  available: () => !!ctor() && !inAndroidWebView(),
  start({ onText, onError, onEnd }) {
    const C = ctor()!;
    const r = new C();
    let text = "";
    let cancelled = false;
    r.lang = "zh-CN";
    r.interimResults = true;
    r.continuous = true;
    r.onresult = (e) => {
      text = Array.from(e.results).map((x) => x[0].transcript).join("");
    };
    r.onerror = (e) => onError(e.error);
    r.onend = () => {
      if (!cancelled && text.trim()) onText(text.trim());
      onEnd();
    };
    r.start();
    return {
      stop: () => r.stop(),
      cancel: () => {
        cancelled = true;
        r.abort();
      },
    };
  },
};
