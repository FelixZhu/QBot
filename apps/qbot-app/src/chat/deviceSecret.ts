import * as SecureStore from "expo-secure-store";
import { TOKEN_KEY, type SecretStore } from "./serverSession.ts";

const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY } as const;

/** Android Keystore / iOS keychain. Never used for the ordinary settings keys. */
export const deviceSecretStorage: SecretStore = {
  async get(key) {
    assertTokenKey(key);
    return SecureStore.getItemAsync(key, options);
  },
  async set(key, value) {
    assertTokenKey(key);
    await SecureStore.setItemAsync(key, value, options);
  },
  async remove(key) {
    assertTokenKey(key);
    await SecureStore.deleteItemAsync(key, options);
  },
};

function assertTokenKey(key: string): void {
  if (key !== TOKEN_KEY) throw new Error("安全存储只接受访问令牌");
}
