import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { WebView as RNWebView } from "react-native-webview";
import type { ComponentType, Ref } from "react";
import { parsePickerMessage, type PickedWire } from "./chatModel.ts";

export type SystemFileChooserHandle = {
  pick(kind: "photo" | "file"): void;
};

type WebViewHandle = { injectJavaScript(script: string): void };

const WebView = RNWebView as unknown as ComponentType<Record<string, unknown> & { ref?: Ref<WebViewHandle> }>;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<input id="photo" type="file" accept="image/*" multiple>
<input id="file" type="file" multiple>
<script>
function post(payload) {
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload));
}
function thumb(file) {
  return new Promise(function (resolve) {
    if (!file.type || file.type.indexOf("image/") !== 0 || file.size > 8 * 1024 * 1024) {
      resolve(null);
      return;
    }
    var url = URL.createObjectURL(file);
    var image = new Image();
    image.onload = function () {
      var max = 256;
      var scale = Math.min(1, max / Math.max(image.width, image.height));
      var canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    image.onerror = function () {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}
async function take(input) {
  var files = Array.prototype.slice.call(input.files || [], 0, 4);
  input.value = "";
  var out = [];
  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    var preview = null;
    try { preview = await thumb(file); } catch (error) { preview = null; }
    out.push({ name: file.name || "未命名", size: file.size || 0, mime: file.type || "application/octet-stream", preview: preview });
  }
  post({ type: "picked", files: out });
}
document.getElementById("photo").addEventListener("change", function (event) { take(event.target); });
document.getElementById("file").addEventListener("change", function (event) { take(event.target); });
window.qbotPick = function (kind) {
  var input = document.getElementById(kind === "file" ? "file" : "photo");
  if (input) input.click();
};
post({ type: "ready" });
</script>
</body></html>`;

type BrowserInput = {
  type: string;
  multiple: boolean;
  accept: string;
  files?: ArrayLike<BrowserFile> | null;
  onchange: (() => void) | null;
  click(): void;
};

type BrowserFile = { name?: string; size?: number; type?: string };

function pickInBrowser(kind: "photo" | "file"): Promise<PickedWire[]> {
  return new Promise((resolve, reject) => {
    const doc = (globalThis as { document?: { createElement(tag: string): BrowserInput } }).document;
    if (!doc) {
      reject(new Error("no document"));
      return;
    }
    const input = doc.createElement("input");
    input.type = "file";
    input.multiple = true;
    if (kind === "photo") input.accept = "image/*";
    input.onchange = () => {
      const list = input.files;
      const files: BrowserFile[] = [];
      const count = Math.min(list?.length ?? 0, 4);
      for (let index = 0; index < count; index += 1) {
        const file = list?.[index];
        if (file) files.push(file);
      }
      resolve(files.map((file) => ({
        name: file.name || "未命名",
        size: file.size || 0,
        mime: file.type || "application/octet-stream",
        preview: null,
      })));
    };
    input.click();
  });
}

export const SystemFileChooser = forwardRef<SystemFileChooserHandle, {
  onPicked: (files: PickedWire[]) => void;
  onUnavailable: () => void;
}>(function SystemFileChooser({ onPicked, onUnavailable }, ref) {
  const webRef = useRef<WebViewHandle>(null);
  const ready = useRef(false);
  const pending = useRef<"photo" | "file" | null>(null);
  const [failed, setFailed] = useState(false);

  const open = (kind: "photo" | "file") => {
    webRef.current?.injectJavaScript(`window.qbotPick(${JSON.stringify(kind)}); true;`);
  };

  useImperativeHandle(ref, () => ({
    pick(kind) {
      if (Platform.OS === "web") {
        pickInBrowser(kind).then(onPicked, () => onUnavailable());
        return;
      }
      if (failed) {
        onUnavailable();
        return;
      }
      if (!ready.current) {
        pending.current = kind;
        return;
      }
      open(kind);
    },
  }), [failed, onPicked, onUnavailable]);

  if (Platform.OS === "web") return null;
  return (
    <View style={{ position: "absolute", width: 1, height: 1, opacity: 0 }} collapsable={false} pointerEvents="none">
      <WebView
        ref={webRef}
        source={{ html: PAGE }}
        style={{ width: 1, height: 1 }}
        javaScriptEnabled
        originWhitelist={["*"]}
        setSupportMultipleWindows={false}
        onMessage={(event: { nativeEvent: { data?: string } }) => {
          const data = event.nativeEvent.data ?? "";
          if (data.includes('"ready"')) {
            ready.current = true;
            const kind = pending.current;
            pending.current = null;
            if (kind) open(kind);
            return;
          }
          const files = parsePickerMessage(data);
          if (files) onPicked(files);
        }}
        onError={() => {
          setFailed(true);
          onUnavailable();
        }}
      />
    </View>
  );
});
