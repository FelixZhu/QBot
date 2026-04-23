import React, { useState } from 'react';
import { Key, Settings, LogOut, ChevronRight, User } from 'lucide-react';
import { Modal } from './Modal';
import { BYOKForm } from './BYOKForm';
import { cn } from '../utils/cn';

export type SettingsTab = 'byok' | 'preferences' | 'about';

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  user?: {
    name: string;
    email: string;
  } | null;
  onLogout?: () => void;
}

interface MenuItem {
  id: SettingsTab;
  label: string;
  icon: React.ReactNode;
  description: string;
}

const menuItems: MenuItem[] = [
  {
    id: 'byok',
    label: 'BYOK',
    icon: <Key className="w-5 h-5" />,
    description: 'API Keys 配置'
  },
  {
    id: 'preferences',
    label: '偏好设置',
    icon: <Settings className="w-5 h-5" />,
    description: '主题、语言等'
  }
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  onClose,
  user,
  onLogout
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('byok');

  const handleLogout = () => {
    onLogout?.();
    onClose();
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'byok':
        return <BYOKForm onSuccess={onClose} />;
      case 'preferences':
        return (
          <div className="text-center text-gray-500 dark:text-gray-400 py-12">
            <Settings className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>偏好设置功能开发中...</p>
          </div>
        );
      case 'about':
        return (
          <div className="text-center py-12">
            <h3 className="text-xl font-bold mb-2">QBot Assistant</h3>
            <p className="text-gray-500 dark:text-gray-400">版本 1.0.0</p>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="xl" showClose={false}>
      <div className="flex h-[500px] -m-6">
        {/* Sidebar */}
        <div className="w-56 border-r border-gray-200 dark:border-gray-800 flex flex-col bg-gray-50 dark:bg-gray-900/50 -mt-0">
          {/* User info */}
          {user && (
            <div className="p-4 border-b border-gray-200 dark:border-gray-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center">
                  <User className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{user.name}</p>
                  <p className="text-xs text-gray-500 truncate">{user.email}</p>
                </div>
              </div>
            </div>
          )}

          {/* Menu items */}
          <nav className="flex-1 p-2">
            {menuItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
                  activeTab === item.id
                    ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                )}
              >
                {item.icon}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {item.description}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 opacity-50" />
              </button>
            ))}
          </nav>

          {/* Logout */}
          {onLogout && (
            <div className="p-2 border-t border-gray-200 dark:border-gray-800">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                <LogOut className="w-5 h-5" />
                <span className="text-sm font-medium">退出登录</span>
              </button>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              {menuItems.find(m => m.id === activeTab)?.label || '设置'}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              ✕
            </button>
          </div>

          {/* Content area */}
          <div className="flex-1 overflow-y-auto p-6">
            {renderContent()}
          </div>
        </div>
      </div>
    </Modal>
  );
};
