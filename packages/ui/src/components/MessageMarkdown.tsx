'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '../utils/cn';

interface MessageMarkdownProps {
  content: string;
  className?: string;
}

export const MessageMarkdown: React.FC<MessageMarkdownProps> = ({ content, className }) => {
  return (
    <div className={cn('prose prose-sm max-w-none dark:prose-invert', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ node, inline, className: codeClassName, children, ...props }: any) {
            const match = /language-(\w+)/.exec(codeClassName || '');
            const language = match ? match[1] : '';
            
            if (!inline && language) {
              return (
                <div className="relative group">
                  <div className="absolute top-2 right-2 text-xs text-gray-400 bg-gray-800 px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                    {language}
                  </div>
                  <SyntaxHighlighter
                    style={oneDark}
                    language={language}
                    PreTag="div"
                    className="rounded-lg !bg-gray-900 !p-4 overflow-x-auto"
                    {...props}
                  >
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                </div>
              );
            }
            
            return (
              <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
                {children}
              </code>
            );
          },
          pre({ children }: any) {
            return <>{children}</>;
          },
          a({ href, children }: any) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 hover:underline"
              >
                {children}
              </a>
            );
          },
          ul({ children }: any) {
            return <ul className="list-disc pl-4 space-y-1">{children}</ul>;
          },
          ol({ children }: any) {
            return <ol className="list-decimal pl-4 space-y-1">{children}</ol>;
          },
          p({ children }: any) {
            return <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
