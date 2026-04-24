"use client";

import { useState } from "react";
import { Settings } from "lucide-react";

interface SystemPromptInputProps {
  value: string;
  onChange: (v: string) => void;
}

export function SystemPromptInput({ value, onChange }: SystemPromptInputProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-2 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <Settings className="w-3.5 h-3.5" />
        <span>System Prompt</span>
        {value && (
          <span className="text-xs text-primary">(set)</span>
        )}
      </button>
      {open && (
        <div className="px-4 pb-3">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Enter a system prompt to set the AI's behavior..."
            className="w-full text-sm border rounded-lg px-3 py-2 bg-background resize-none outline-none focus:ring-1 focus:ring-ring"
            rows={3}
          />
        </div>
      )}
    </div>
  );
}
