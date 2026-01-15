import React, { createContext, useContext, useState, ReactNode } from 'react';

interface TagFilterContextType {
  selectedTags: string[];
  filterMode: 'any' | 'all';
  addTag: (tag: string) => void;
  removeTag: (tag: string) => void;
  toggleTag: (tag: string) => void;
  clearTags: () => void;
  setFilterMode: (mode: 'any' | 'all') => void;
}

const TagFilterContext = createContext<TagFilterContextType | undefined>(undefined);

export const useTagFilter = (): TagFilterContextType => {
  const context = useContext(TagFilterContext);
  if (!context) {
    throw new Error('useTagFilter must be used within a TagFilterProvider');
  }
  return context;
};

interface TagFilterProviderProps {
  children: ReactNode;
}

export const TagFilterProvider: React.FC<TagFilterProviderProps> = ({ children }) => {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [filterMode, setFilterMode] = useState<'any' | 'all'>('any');

  const addTag = (tag: string) => {
    if (!selectedTags.includes(tag)) {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  const removeTag = (tag: string) => {
    setSelectedTags(selectedTags.filter((t) => t !== tag));
  };

  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      removeTag(tag);
    } else {
      addTag(tag);
    }
  };

  const clearTags = () => {
    setSelectedTags([]);
  };

  return (
    <TagFilterContext.Provider
      value={{
        selectedTags,
        filterMode,
        addTag,
        removeTag,
        toggleTag,
        clearTags,
        setFilterMode,
      }}
    >
      {children}
    </TagFilterContext.Provider>
  );
};
