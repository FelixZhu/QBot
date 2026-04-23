import React from 'react';

export interface ModelSelectorProps {
  models: Array<{ id: string; name: string }>;
  selectedModel: string;
  onModelChange: (modelId: string) => void;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  models,
  selectedModel,
  onModelChange,
}) => {
  return (
    <select
      value={selectedModel}
      onChange={(e) => onModelChange(e.target.value)}
      className="model-selector"
    >
      {models.map((model) => (
        <option key={model.id} value={model.id}>
          {model.name}
        </option>
      ))}
    </select>
  );
};
