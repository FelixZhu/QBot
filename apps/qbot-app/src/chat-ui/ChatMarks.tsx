import { Image, type ImageSourcePropType } from "react-native";

/**
 * Lucide line icons (ISC), drawn as tinted bitmaps.
 * react-native-svg is not in the 1.0.10 binary, so these stay in the JS bundle.
 * The stop square is a plain filled mark, not a Lucide glyph.
 */

const marks = {
  menu: require("./marks/menu.png"),
  pencil: require("./marks/pencil.png"),
  more: require("./marks/more.png"),
  plus: require("./marks/plus.png"),
  mic: require("./marks/mic.png"),
  wave: require("./marks/wave.png"),
  up: require("./marks/up.png"),
  stop: require("./marks/stop.png"),
  close: require("./marks/close.png"),
  copy: require("./marks/copy.png"),
  share: require("./marks/share.png"),
  play: require("./marks/play.png"),
  "up-thumb": require("./marks/up-thumb.png"),
  "down-thumb": require("./marks/down-thumb.png"),
  retry: require("./marks/retry.png"),
  check: require("./marks/check.png"),
  camera: require("./marks/camera.png"),
  image: require("./marks/image.png"),
  file: require("./marks/file.png"),
  book: require("./marks/book.png"),
  chevron: require("./marks/chevron.png"),
  back: require("./marks/chevron.png"),
} as const satisfies Record<string, ImageSourcePropType>;

export type MarkName = keyof typeof marks;

export function ChatMark({ name, color, size = 22 }: { name: MarkName; color: string; size?: number }) {
  return (
    <Image
      source={marks[name]}
      fadeDuration={0}
      resizeMode="contain"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        tintColor: color,
        ...(name === "back" ? { transform: [{ rotate: "180deg" }] } : {}),
      }}
    />
  );
}
