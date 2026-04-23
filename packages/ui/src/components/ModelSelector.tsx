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
