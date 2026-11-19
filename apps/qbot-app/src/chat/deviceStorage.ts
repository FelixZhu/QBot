import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ChatStorage } from "./history";

/** On-device store for demo threads. No account, no server. */
export const deviceChatStorage: ChatStorage = AsyncStorage;
