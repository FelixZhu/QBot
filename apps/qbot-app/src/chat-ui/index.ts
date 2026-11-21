/**
 * Display layer for a runtime the parent already created.
 * Does not construct a runtime, transport, or history.
 *
 * import { AssistantRuntimeProvider } from "@assistant-ui/react-native";
 * import { ChatThreadSurface } from "./chat-ui";
 *
 * <AssistantRuntimeProvider runtime={runtime}>
 *   <ChatThreadSurface scheme="light" bottomSafeArea="self" />
 * </AssistantRuntimeProvider>
 *
 * Pass bottomSafeArea="parent" when a bar under the thread already pads the
 * home indicator. The live thread hides that bar and uses "self".
 */
export { ChatThreadSurface, type ChatThreadSurfaceProps } from "./ChatThreadSurface";
export { copyText } from "./copyText";
