'use client';

import React from 'react';
import { MessageSquare, Plus, Trash2 } from 'lucide-react';
import { cn } from '../utils/cn';

export interface ConversationItem {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ConversationListProps {
  conversations: ConversationItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete
}) => {
  const groupByDate = (conversations: ConversationItem[]) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);
    const lastMonth = new Date(today);
    lastMonth.setDate(lastMonth.getDate() - 30);

    const groups: { [key: string]: ConversationItem[] } = {
      'Today': [],
      'Yesterday': [],
      'Previous 7 Days': [],
      'Previous 30 Days': [],
      'Older': []
    };

    conversations.forEach(conv => {
      const date = new Date(conv.updatedAt);
      if (date >= today) {
        groups['Today'].push(conv);
      } else if (date >= yesterday) {
        groups['Yesterday'].push(conv);
      } else if (date >= lastWeek) {
        groups['Previous 7 Days'].push(conv);
      } else if (date >= lastMonth) {
        groups['Previous 30 Days'].push(conv);
      } else {
        groups['Older'].push(conv);
      }
    });

    return groups;
  };

  const grouped = groupByDate(conversations);

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      {/* New Chat Button */}
      <div className="p-3">
        <button
          onClick={onNew}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          <span className="font-medium">New chat</span>
        </button>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto px-2">
        {Object.entries(grouped).map(([group, items]) => {
          if (items.length === 0) return null;
          return (
            <div key={group} className="mb-4">
              <h3 className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
                {group}
              </h3>
              <div className="space-y-1">
                {items.map(conv => (
                  <div
                    key={conv.id}
                    className={cn(
                      'group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors',
                      activeId === conv.id
                        ? 'bg-gray-200 dark:bg-gray-700'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                    )}
                    onClick={() => onSelect(conv.id)}
                  >
                    <MessageSquare className="w-4 h-4 flex-shrink-0 text-gray-400" />
                    <span className="flex-1 truncate text-sm">{conv.title}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(conv.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-300 dark:hover:bg-gray-600 rounded transition-opacity"
                    >
                      <Trash2 className="w-4 h-4 text-gray-400" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {conversations.length === 0 && (
          <div className="text-center text-gray-400 dark:text-gray-500 py-8 text-sm">
            No conversations yet
          </div>
        )}
      </div>
    </div>
  );
};
