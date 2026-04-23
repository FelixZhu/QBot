# QBot Assistant - Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build UI component library and web application with user authentication and cloud sync.

**Architecture:** React 18 UI components in @qbot/ui package. Web application using Next.js 14 with App Router, API Routes for CORS proxy, and authentication system. Cloud sync using Aliyun OSS.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Next.js 14, NextAuth.js, Aliyun OSS SDK

---

## Part A: UI Component Library

### Task A1: Setup @qbot/ui Package

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/tailwind.config.js`
- Create: `packages/ui/postcss.config.js`
- Create: `packages/ui/src/index.ts`
- Create: `packages/ui/src/styles/globals.css`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@qbot/ui",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./styles": "./dist/styles/globals.css"
  },
  "scripts": {
    "build": "tsup && postcss src/styles/*.css --dir dist/styles",
    "dev": "tsup --watch",
    "lint": "eslint src/"
  },
  "dependencies": {
    "@qbot/core": "workspace:*",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "typescript": "^5.3.0",
    "tsup": "^8.0.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0",
    "postcss-cli": "^11.0.0"
  },
  "peerDependencies": {
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create tailwind.config.js**

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
        },
        dark: {
          bg: '#1a1a2e',
          surface: '#16213e',
          border: '#0f3460',
        }
      }
    },
  },
  plugins: [],
}
```

- [ ] **Step 4: Create postcss.config.js**

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

- [ ] **Step 5: Create globals.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
  }
}

@layer components {
  .btn {
    @apply px-4 py-2 rounded-lg font-medium transition-colors;
  }

  .btn-primary {
    @apply bg-primary-600 text-white hover:bg-primary-700;
  }

  .input {
    @apply w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500;
  }
}
```

- [ ] **Step 6: Create src/index.ts**

```typescript
// Components
export * from './components/Button';
export * from './components/Input';
export * from './components/ChatView';
export * from './components/MessageList';
export * from './components/InputArea';
export * from './components/ModelSelector';

// Hooks
export * from './hooks/useChat';
export * from './hooks/useTheme';

// Utils
export * from './utils/cn';
```

- [ ] **Step 7: Install dependencies**

Run: `pnpm install`

- [ ] **Step 8: Commit**

```bash
git add packages/ui/
git commit -m "feat(ui): initialize @qbot/ui package with Tailwind CSS"
```

---

### Task A2: Basic UI Components

**Files:**
- Create: `packages/ui/src/utils/cn.ts`
- Create: `packages/ui/src/components/Button.tsx`
- Create: `packages/ui/src/components/Input.tsx`

- [ ] **Step 1: Create cn utility**

```typescript
// packages/ui/src/utils/cn.ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 2: Create Button component**

```typescript
// packages/ui/src/components/Button.tsx
import React from 'react';
import { cn } from '../utils/cn';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-lg font-medium transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
          'disabled:opacity-50 disabled:pointer-events-none',
          {
            'bg-primary-600 text-white hover:bg-primary-700': variant === 'primary',
            'bg-gray-200 text-gray-900 hover:bg-gray-300': variant === 'secondary',
            'bg-transparent hover:bg-gray-100': variant === 'ghost',
          },
          {
            'px-3 py-1.5 text-sm': size === 'sm',
            'px-4 py-2 text-base': size === 'md',
            'px-6 py-3 text-lg': size === 'lg',
          },
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';
```

- [ ] **Step 3: Create Input component**

```typescript
// packages/ui/src/components/Input.tsx
import React from 'react';
import { cn } from '../utils/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={cn(
            'w-full px-3 py-2 border rounded-lg',
            'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent',
            'placeholder:text-gray-400',
            error ? 'border-red-500' : 'border-gray-300',
            className
          )}
          {...props}
        />
        {error && (
          <p className="mt-1 text-sm text-red-500">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/
git commit -m "feat(ui): add Button and Input components"
```

---

### Task A3: Chat Components

**Files:**
- Create: `packages/ui/src/components/MessageList.tsx`
- Create: `packages/ui/src/components/InputArea.tsx`
- Create: `packages/ui/src/components/ChatView.tsx`

- [ ] **Step 1: Create MessageList component**

```typescript
// packages/ui/src/components/MessageList.tsx
import React from 'react';
import type { ChatMessage } from '@qbot/core';
import { cn } from '../utils/cn';

export interface MessageListProps {
  messages: ChatMessage[];
  isLoading?: boolean;
}

export const MessageList: React.FC<MessageListProps> = ({ messages, isLoading }) => {
  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto">
      {messages.map((message, index) => (
        <div
          key={index}
          className={cn(
            'flex',
            message.role === 'user' ? 'justify-end' : 'justify-start'
          )}
        >
          <div
            className={cn(
              'max-w-[80%] rounded-lg px-4 py-2',
              message.role === 'user'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-900'
            )}
          >
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        </div>
      ))}
      {isLoading && (
        <div className="flex justify-start">
          <div className="bg-gray-100 rounded-lg px-4 py-2">
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.1s]" />
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.2s]" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Create InputArea component**

```typescript
// packages/ui/src/components/InputArea.tsx
import React, { useState, useRef } from 'react';
import { Button } from './Button';

export interface InputAreaProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export const InputArea: React.FC<InputAreaProps> = ({
  onSend,
  disabled,
  placeholder = 'Type a message...'
}) => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (input.trim() && !disabled) {
      onSend(input.trim());
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t p-4">
      <div className="flex gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1 resize-none border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
          rows={1}
        />
        <Button onClick={handleSend} disabled={disabled || !input.trim()}>
          Send
        </Button>
      </div>
      <p className="text-xs text-gray-500 mt-1">
        Press Enter to send, Shift+Enter for new line
      </p>
    </div>
  );
};
```

- [ ] **Step 3: Create ChatView component**

```typescript
// packages/ui/src/components/ChatView.tsx
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
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/
git commit -m "feat(ui): add ChatView, MessageList, InputArea components"
```

---

### Task A4: Model Selector Component

**Files:**
- Create: `packages/ui/src/components/ModelSelector.tsx`

- [ ] **Step 1: Create ModelSelector component**

```typescript
// packages/ui/src/components/ModelSelector.tsx
import React from 'react';
import { cn } from '../utils/cn';

export interface Model {
  id: string;
  name: string;
  provider: string;
}

export interface ModelSelectorProps {
  models: Model[];
  selectedModel: string;
  onSelect: (modelId: string) => void;
  className?: string;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  models,
  selectedModel,
  onSelect,
  className
}) => {
  const [isOpen, setIsOpen] = React.useState(false);

  const selectedModelInfo = models.find(m => m.id === selectedModel);

  const groupedModels = React.useMemo(() => {
    const groups: Record<string, Model[]> = {};
    for (const model of models) {
      if (!groups[model.provider]) {
        groups[model.provider] = [];
      }
      groups[model.provider].push(model);
    }
    return groups;
  }, [models]);

  return (
    <div className={cn('relative', className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 border rounded-lg hover:bg-gray-50"
      >
        <span className="text-sm">{selectedModelInfo?.name || 'Select model'}</span>
        <svg
          className={cn('w-4 h-4 transition-transform', isOpen && 'rotate-180')}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-white border rounded-lg shadow-lg z-10">
          {Object.entries(groupedModels).map(([provider, providerModels]) => (
            <div key={provider}>
              <div className="px-3 py-2 text-xs font-semibold text-gray-500 bg-gray-50">
                {provider.toUpperCase()}
              </div>
              {providerModels.map((model) => (
                <button
                  key={model.id}
                  onClick={() => {
                    onSelect(model.id);
                    setIsOpen(false);
                  }}
                  className={cn(
                    'w-full text-left px-3 py-2 text-sm hover:bg-gray-100',
                    model.id === selectedModel && 'bg-primary-50 text-primary-600'
                  )}
                >
                  {model.name}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/ModelSelector.tsx
git commit -m "feat(ui): add ModelSelector component with grouped models"
```

---

### Task A5: useChat Hook

**Files:**
- Create: `packages/ui/src/hooks/useChat.ts`
- Create: `packages/ui/src/hooks/useTheme.ts`

- [ ] **Step 1: Create useChat hook**

```typescript
// packages/ui/src/hooks/useChat.ts
import { useState, useCallback } from 'react';
import type { ChatMessage, CompletionResult } from '@qbot/core';

export interface UseChatOptions {
  initialMessages?: ChatMessage[];
  onMessage?: (result: CompletionResult) => void;
  onError?: (error: Error) => void;
}

export interface UseChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
  error: Error | null;
}

export function useChat(
  chatFn: (messages: ChatMessage[]) => Promise<CompletionResult>,
  options: UseChatOptions = {}
): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>(options.initialMessages || []);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const sendMessage = useCallback(async (content: string) => {
    const userMessage: ChatMessage = { role: 'user', content };
    const newMessages = [...messages, userMessage];

    setMessages(newMessages);
    setIsLoading(true);
    setError(null);

    try {
      const result = await chatFn(newMessages);
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: result.content
      };

      setMessages([...newMessages, assistantMessage]);
      options.onMessage?.(result);
    } catch (err) {
      const error = err as Error;
      setError(error);
      options.onError?.(error);
    } finally {
      setIsLoading(false);
    }
  }, [messages, chatFn, options]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return {
    messages,
    isLoading,
    sendMessage,
    clearMessages,
    error
  };
}
```

- [ ] **Step 2: Create useTheme hook**

```typescript
// packages/ui/src/hooks/useTheme.ts
import { useState, useEffect } from 'react';

export type Theme = 'light' | 'dark';

export interface UseThemeReturn {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

export function useTheme(defaultTheme: Theme = 'light'): UseThemeReturn {
  const [theme, setThemeState] = useState<Theme>(defaultTheme);

  useEffect(() => {
    const saved = localStorage.getItem('qbot-theme') as Theme;
    if (saved) {
      setThemeState(saved);
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('qbot-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setThemeState(prev => prev === 'light' ? 'dark' : 'light');
  };

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  return { theme, toggleTheme, setTheme };
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/hooks/
git commit -m "feat(ui): add useChat and useTheme hooks"
```

---

### Task A6: Build UI Package

- [ ] **Step 1: Create tsup.config.ts**

```typescript
// packages/ui/tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  target: 'node18',
  clean: true,
  external: ['react', 'react-dom']
});
```

- [ ] **Step 2: Build and verify**

Run: `cd packages/ui && pnpm build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/ui/tsup.config.ts
git commit -m "feat(ui): add build configuration and finalize package"
```

---

## Part B: Web Application (Next.js)

### Task B1: Setup Next.js Project

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/next.config.js`
- Create: `packages/web/tailwind.config.js`
- Create: `packages/web/postcss.config.js`
- Create: `packages/web/tsconfig.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@qbot/web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "@qbot/core": "workspace:*",
    "@qbot/ui": "workspace:*",
    "next": "^14.1.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "next-auth": "^4.24.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "typescript": "^5.3.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0",
    "eslint": "^8.56.0",
    "eslint-config-next": "^14.1.0"
  }
}
```

- [ ] **Step 2: Create next.config.js**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@qbot/core', '@qbot/ui'],
  experimental: {
    serverActions: true
  }
};

module.exports = nextConfig;
```

- [ ] **Step 3: Create tailwind.config.js**

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {}
  },
  plugins: []
};
```

- [ ] **Step 4: Create postcss.config.js**

```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
};
```

- [ ] **Step 5: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "esnext",
    "jsx": "preserve",
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 6: Install dependencies**

Run: `pnpm install`

- [ ] **Step 7: Commit**

```bash
git add packages/web/
git commit -m "feat(web): initialize Next.js project"
```

---

### Task B2: App Layout and Pages

**Files:**
- Create: `packages/web/app/layout.tsx`
- Create: `packages/web/app/page.tsx`
- Create: `packages/web/app/globals.css`

- [ ] **Step 1: Create globals.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 2: Create layout.tsx**

```typescript
// packages/web/app/layout.tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'QBot Assistant',
  description: 'Super Personal Assistant'
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Create page.tsx**

```typescript
// packages/web/app/page.tsx
import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">QBot Assistant</h1>
        <p className="text-gray-600 mb-8">Super Personal Assistant</p>
        <div className="flex gap-4">
          <Link
            href="/chat"
            className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            Start Chat
          </Link>
          <Link
            href="/login"
            className="px-6 py-3 border rounded-lg hover:bg-gray-50"
          >
            Login
          </Link>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/app/
git commit -m "feat(web): add layout and home page"
```

---

### Task B3: Chat Page

**Files:**
- Create: `packages/web/app/chat/page.tsx`
- Create: `packages/web/app/api/chat/route.ts`

- [ ] **Step 1: Create chat page**

```typescript
// packages/web/app/chat/page.tsx
'use client';

import { useState, useCallback } from 'react';
import { ChatView, ModelSelector, useChat } from '@qbot/ui';
import type { ChatMessage, CompletionResult } from '@qbot/core';

const MODELS = [
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'openrouter' },
  { id: 'openai/gpt-4', name: 'GPT-4', provider: 'openrouter' },
  { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek' },
];

export default function ChatPage() {
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id);

  const chatFn = useCallback(async (messages: ChatMessage[]): Promise<CompletionResult> => {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, model: selectedModel })
    });

    if (!response.ok) {
      throw new Error('Chat request failed');
    }

    return response.json();
  }, [selectedModel]);

  const { messages, isLoading, sendMessage, error } = useChat(chatFn);

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b p-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">QBot Chat</h1>
        <ModelSelector
          models={MODELS}
          selectedModel={selectedModel}
          onSelect={setSelectedModel}
        />
      </header>
      <main className="flex-1 overflow-hidden">
        <ChatView
          messages={messages}
          onSendMessage={sendMessage}
          isLoading={isLoading}
        />
      </main>
      {error && (
        <div className="bg-red-100 text-red-700 p-2 text-center">
          {error.message}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create chat API route**

```typescript
// packages/web/app/api/chat/route.ts
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export async function POST(request: NextRequest) {
  try {
    const { messages, model } = await request.json();

    // Get API key from environment or user session
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key not configured' },
        { status: 500 }
      );
    }

    const openai = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1'
    });

    const completion = await openai.chat.completions.create({
      model,
      messages: messages.map((m: any) => ({
        role: m.role,
        content: m.content
      }))
    });

    return NextResponse.json({
      content: completion.choices[0]?.message?.content || '',
      model,
      provider: 'openrouter'
    });
  } catch (error) {
    console.error('Chat error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/app/
git commit -m "feat(web): add chat page and API route"
```

---

## Part C: Authentication & Sync (Future)

*To be planned in detail after Part A and B are complete.*

---

## Self-Review Checklist

- [ ] All UI components created
- [ ] Hooks implemented
- [ ] UI package builds successfully
- [ ] Next.js project configured
- [ ] Chat page works with API route
- [ ] All commits follow semantic commit format
