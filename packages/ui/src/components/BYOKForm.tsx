import React, { useState, useEffect } from 'react';
import { Key, Plus, Trash2, Check, AlertCircle, Loader2, Eye, EyeOff } from 'lucide-react';
import { Button } from './Button';
import { cn } from '../utils/cn';

interface ProviderKeyInfo {
  provider: string;
  hasKey: boolean;
  keyPreview: string;
  baseUrl?: string;
}

interface BYOKFormProps {
  onSuccess?: () => void;
}

export const BYOKForm: React.FC<BYOKFormProps> = ({ onSuccess }) => {
  const [keys, setKeys] = useState<ProviderKeyInfo[]>([]);
  const [newKey, setNewKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [detectedProvider, setDetectedProvider] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Load existing keys
  useEffect(() => {
    loadKeys();
  }, []);

  const loadKeys = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/config/keys');
      if (res.ok) {
        const data = await res.json();
        const providerList = Object.values(data.providers) as ProviderKeyInfo[];
        setKeys(providerList.filter(k => k.hasKey));
      }
    } catch (err) {
      console.error('Failed to load keys:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Detect provider from key format
  const detectProvider = (key: string): string | null => {
    if (key.startsWith('sk-or-v1-')) return 'openrouter';
    if (key.startsWith('sk-ant-')) return 'anthropic';
    if (/^sk-[a-f0-9]{32,}$/.test(key)) return 'deepseek';
    if (key.startsWith('sk-')) return 'openai';
    return null;
  };

  const handleKeyInput = (value: string) => {
    setNewKey(value);
    setError(null);
    setSuccess(null);

    if (value.length > 10) {
      const detected = detectProvider(value);
      setDetectedProvider(detected);
    } else {
      setDetectedProvider(null);
    }
  };

  const handleAddKey = async () => {
    if (!newKey.trim() || !detectedProvider) return;

    setIsSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/config/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: newKey,
          provider: detectedProvider
        })
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess(`${data.providerName} API Key 已保存`);
        setNewKey('');
        setDetectedProvider(null);
        await loadKeys();
      } else {
        setError(data.error || '保存失败');
      }
    } catch (err) {
      setError('保存失败，请重试');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteKey = async (provider: string) => {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/config/keys?provider=${provider}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        setSuccess(`${provider} API Key 已删除`);
        await loadKeys();
      }
    } catch (err) {
      setError('删除失败');
    } finally {
      setIsSaving(false);
    }
  };

  const getProviderLabel = (provider: string): string => {
    const labels: Record<string, string> = {
      openrouter: 'OpenRouter',
      openai: 'OpenAI',
      anthropic: 'Anthropic',
      deepseek: 'DeepSeek'
    };
    return labels[provider] || provider;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          API Keys (BYOK)
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          配置您的 API Keys，支持 OpenRouter、OpenAI、Anthropic、DeepSeek
        </p>
      </div>

      {/* Error/Success messages */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-500" />
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <Check className="w-4 h-4 text-green-500" />
          <p className="text-sm text-green-600 dark:text-green-400">{success}</p>
        </div>
      )}

      {/* Existing keys */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : (
        keys.length > 0 && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              已配置的 Keys
            </label>
            {keys.map((key) => (
              <div
                key={key.provider}
                className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
              >
                <Key className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <span className="flex-1 font-mono text-sm text-gray-600 dark:text-gray-400 truncate">
                  {key.keyPreview}
                </span>
                <span className="text-xs px-2 py-1 bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300 rounded font-medium">
                  {getProviderLabel(key.provider)}
                </span>
                <button
                  onClick={() => handleDeleteKey(key.provider)}
                  disabled={isSaving}
                  className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 transition-colors"
                  title="删除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )
      )}

      {/* Add new key */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          添加新的 API Key
        </label>

        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={newKey}
            onChange={(e) => handleKeyInput(e.target.value)}
            placeholder="粘贴您的 API Key..."
            className="w-full px-4 py-3 pr-20 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"
              title={showKey ? '隐藏' : '显示'}
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Detection result */}
        {detectedProvider && (
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <Check className="w-4 h-4" />
            <span>检测到: <strong>{getProviderLabel(detectedProvider)}</strong></span>
          </div>
        )}

        {newKey && !detectedProvider && (
          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
            <AlertCircle className="w-4 h-4" />
            <span>无法识别此 API Key 格式</span>
          </div>
        )}

        <Button
          onClick={handleAddKey}
          disabled={!newKey || !detectedProvider || isSaving}
          className="w-full"
        >
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              保存中...
            </>
          ) : (
            <>
              <Plus className="w-4 h-4 mr-2" />
              添加 API Key
            </>
          )}
        </Button>
      </div>

      {/* Help text */}
      <div className="text-xs text-gray-400 dark:text-gray-500 space-y-1 pt-4 border-t border-gray-200 dark:border-gray-800">
        <p>支持的 API Key 格式:</p>
        <ul className="list-disc list-inside space-y-0.5 ml-2">
          <li><code className="text-primary-600 dark:text-primary-400">sk-or-v1-xxx</code> - OpenRouter</li>
          <li><code className="text-primary-600 dark:text-primary-400">sk-ant-xxx</code> - Anthropic</li>
          <li><code className="text-primary-600 dark:text-primary-400">sk-xxx</code> - OpenAI / DeepSeek</li>
        </ul>
      </div>
    </div>
  );
};
