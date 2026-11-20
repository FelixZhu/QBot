/**
 * Display layer for a runtime the parent already created.
 * Does not construct a runtime, transport, or history.
 *
 * import { AssistantRuntimeProvider } from "@assistant-ui/react-native";
 * import { ChatThreadSurface } from "./chat-ui";
 *
 * <AssistantRuntimeProvider runtime={runtime}>
 *   <ChatThreadSurface colors={colors} bottomSafeArea="self" />
 * </AssistantRuntimeProvider>
 *
 * The demo passes bottomSafeArea="parent" because the tab bar owns the
 * home-indicator inset. Pass suggestions and listHeader only for that demo.
 */
export { ChatThreadSurface, type ChatThreadSurfaceProps } from "./ChatThreadSurface";
export { copyText } from "./copyText";
