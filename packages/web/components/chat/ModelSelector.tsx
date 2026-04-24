"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Search, ChevronDown, ImageIcon } from "lucide-react";
import { modelApi } from "@/lib/api";

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  modality?: string;
}

interface ModelSelectorProps {
  selectedModel: string;
  onSelect: (modelId: string) => void;
}

export function ModelSelector({ selectedModel, onSelect }: ModelSelectorProps) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 加载模型列表
  useEffect(() => {
    modelApi
      .list()
      .then((data) => setModels(data.models || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // 点击外部关闭下拉
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 过滤模型
  const filteredModels = useMemo(() => {
    if (!search.trim()) return models;
    const q = search.toLowerCase();
    return models.filter(
      (m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
    );
  }, [models, search]);

  // 按提供商分组
  const groupedModels = useMemo(() => {
    const groups: Record<string, ModelInfo[]> = {};
    for (const model of filteredModels) {
      const key = model.provider || "other";
      if (!groups[key]) groups[key] = [];
      groups[key].push(model);
    }
    return groups;
  }, [filteredModels]);

  const selectedName = models.find((m) => m.id === selectedModel)?.name || selectedModel;

  const handleSelect = useCallback(
    (modelId: string) => {
      onSelect(modelId);
      setIsOpen(false);
      setSearch("");
    },
    [onSelect]
  );

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm border rounded-lg hover:bg-muted transition-colors"
      >
        <span className="max-w-[200px] truncate">{selectedName}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-1 w-80 bg-background border rounded-lg shadow-xl z-50 flex flex-col max-h-[70vh]">
          {/* 搜索框 */}
          <div className="p-2 border-b">
            <div className="flex items-center gap-2 px-2 py-1.5 bg-muted rounded-md">
              <Search className="w-3.5 h-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models..."
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                autoFocus
              />
            </div>
          </div>

          {/* 模型列表 */}
          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Loading models...
              </div>
            ) : filteredModels.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No models found
              </div>
            ) : (
              Object.entries(groupedModels).map(([provider, providerModels]) => (
                <div key={provider}>
                  <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50 sticky top-0">
                    {provider.toUpperCase()}
                  </div>
                  {providerModels.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => handleSelect(model.id)}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center justify-between ${
                        model.id === selectedModel
                          ? "bg-primary/10 text-primary"
                          : ""
                      }`}
                    >
                      <span className="truncate flex-1">{model.name}</span>
                      {model.modality?.includes("image") && (
                        <ImageIcon className="w-3.5 h-3.5 text-muted-foreground ml-2 flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
