import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from "react-native";
import type { Palette } from "../theme";

export function TokenModal({
  visible,
  colors,
  hasToken,
  onClose,
  onSubmit,
  onClear,
}: {
  visible: boolean;
  colors: Palette;
  hasToken: boolean;
  onClose: () => void;
  onSubmit: (rawToken: string) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setValue("");
    setError(null);
    setBusy(false);
  }, [visible]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(value);
      setValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "口令验证失败");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onClear();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 20 }}
      >
        <View
          style={{
            backgroundColor: colors.bg,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: colors.line,
            padding: 20,
            maxWidth: 420,
            width: "100%",
            alignSelf: "center",
          }}
        >
          <Text style={{ fontSize: 18, lineHeight: 24, fontWeight: "700", color: colors.text }}>访问口令</Text>
          <Text style={{ marginTop: 6, fontSize: 14, lineHeight: 20, color: colors.muted }}>
            粘贴服务器访问令牌。验证通过后只保存在本机安全存储。
          </Text>
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder="输入访问口令"
            placeholderTextColor={colors.muted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            returnKeyType="done"
            onSubmitEditing={() => { void submit(); }}
            accessibilityLabel="输入访问口令"
            style={{
              marginTop: 14,
              height: 44,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.line,
              paddingHorizontal: 12,
              fontSize: 15,
              color: colors.text,
              backgroundColor: colors.canvas,
            }}
          />
          {error ? (
            <Text style={{ marginTop: 8, fontSize: 13, lineHeight: 18, color: colors.accentInk }}>{error}</Text>
          ) : null}
          <View style={{ marginTop: 18, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 12 }}>
            {hasToken ? (
              <Pressable
                onPress={() => { void clear(); }}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="清除口令"
                style={{ marginRight: "auto", minHeight: 40, justifyContent: "center", paddingHorizontal: 4 }}
              >
                <Text style={{ fontSize: 14, color: colors.muted }}>清除口令</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={onClose}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="取消"
              style={{ minHeight: 40, justifyContent: "center", paddingHorizontal: 12 }}
            >
              <Text style={{ fontSize: 15, color: colors.muted }}>取消</Text>
            </Pressable>
            <Pressable
              onPress={() => { void submit(); }}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="连接"
              style={{
                minHeight: 40,
                paddingHorizontal: 18,
                borderRadius: 12,
                backgroundColor: colors.accentInk,
                alignItems: "center",
                justifyContent: "center",
                opacity: busy ? 0.6 : 1,
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.bg }}>{busy ? "验证中..." : "连接"}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
