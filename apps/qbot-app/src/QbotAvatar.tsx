import { Image } from "react-native";

const source = require("../assets/brand/qbot-avatar.png");

/** Circular crop of the C1 mascot. 24, 32, and 48 are the sizes the chat uses. */
export function QbotAvatar({ size }: { size: 24 | 32 | 36 | 48 }) {
  return (
    <Image
      source={source}
      fadeDuration={0}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: size / 2 }}
    />
  );
}
