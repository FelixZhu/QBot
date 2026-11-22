import AsyncStorage from "@react-native-async-storage/async-storage";
import { CONVERSATION_KEY, URL_KEY, type SettingsStore } from "./serverSession.ts";

const ALLOWED = new Set([URL_KEY, CONVERSATION_KEY]);

/** Plain storage for the server origin and conversation id. The token is not allowed here. */
export const deviceServerSettings: SettingsStore = {
  async getItem(key) {
    assertSettingsKey(key);
    return AsyncStorage.getItem(key);
  },
  async setItem(key, value) {
    assertSettingsKey(key);
    await AsyncStorage.setItem(key, value);
  },
  async removeItem(key) {
    assertSettingsKey(key);
    await AsyncStorage.removeItem(key);
  },
};

function assertSettingsKey(key: string): void {
  if (!ALLOWED.has(key)) throw new Error("普通存储拒绝这个键");
}
