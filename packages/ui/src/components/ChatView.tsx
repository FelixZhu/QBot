import React from 'react';

export interface ChatViewProps {
  conversationId?: string;
}

export const ChatView: React.FC<ChatViewProps> = ({ conversationId }) => {
  return (
    <div className="chat-view">
      <div className="message-list">
        {/* MessageList will be rendered here */}
      </div>
      <div className="input-area">
        {/* InputArea will be rendered here */}
      </div>
    </div>
  );
};
