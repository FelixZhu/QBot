import React from 'react';

export interface MessageListProps {
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
  }>;
}

export const MessageList: React.FC<MessageListProps> = ({ messages }) => {
  return (
    <div className="message-list">
      {messages.map((message) => (
        <div key={message.id} className={`message message-${message.role}`}>
          {message.content}
        </div>
      ))}
    </div>
  );
};
