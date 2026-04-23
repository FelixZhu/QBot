import React from 'react';
import { MessageList } from './MessageList';
import { InputArea } from './InputArea';
import type { ChatMessage } from '@qbot/core';

export interface ChatViewProps {
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  isLoading?: boolean;
  disabled?: boolean;
}

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  onSendMessage,
  isLoading,
  disabled
}) => {
  return (
    <div className="flex flex-col h-full bg-white dark:bg-dark-bg">
      <MessageList messages={messages} isLoading={isLoading} />
      <InputArea onSend={onSendMessage} disabled={disabled || isLoading} />
    </div>
  );
};
