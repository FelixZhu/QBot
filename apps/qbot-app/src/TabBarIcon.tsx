import { Image } from "react-native";

type Name = "discover" | "chat" | "library";
type Tone = "light" | "dark";

const ICONS = {
  discover: {
    light: {
      on: require("../assets/tabbar/discover-selected-light.png"),
      off: require("../assets/tabbar/discover-unselected-light.png"),
    },
    dark: {
      on: require("../assets/tabbar/discover-selected-dark.png"),
      off: require("../assets/tabbar/discover-unselected-dark.png"),
    },
  },
  chat: {
    light: {
      on: require("../assets/tabbar/chat-selected-light.png"),
      off: require("../assets/tabbar/chat-unselected-light.png"),
    },
    dark: {
      on: require("../assets/tabbar/chat-selected-dark.png"),
      off: require("../assets/tabbar/chat-unselected-dark.png"),
    },
  },
  library: {
    light: {
      on: require("../assets/tabbar/library-selected-light.png"),
      off: require("../assets/tabbar/library-unselected-light.png"),
    },
    dark: {
      on: require("../assets/tabbar/library-selected-dark.png"),
      off: require("../assets/tabbar/library-unselected-dark.png"),
    },
  },
} as const;

/** Baked PNGs of icons/a. Orange is already in the selected files, so they are not tinted. */
export function TabBarIcon({ name, tone, selected }: { name: Name; tone: Tone; selected: boolean }) {
  return (
    <Image
      source={ICONS[name][tone][selected ? "on" : "off"]}
      fadeDuration={0}
      style={{ width: 24, height: 24 }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
