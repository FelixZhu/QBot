import React, { useState } from 'react';

export interface InputAreaProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export const InputArea: React.FC<InputAreaProps> = ({ onSend, disabled = false }) => {
  const [input, setInput] = useState('');

  const handleSend = () => {
    if (input.trim() && !disabled) {
      onSend(input.trim());
      setInput('');
    }
  };

  return (
    <div className="input-area">
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Type your message..."
        disabled={disabled}
        className="input"
      />
      <button onClick={handleSend} disabled={disabled || !input.trim()} className="btn btn-primary">
        Send
      </button>
    </div>
  );
};
