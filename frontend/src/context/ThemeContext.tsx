import React, { createContext, useContext } from 'react';

// We're keeping the interface the same for compatibility,
// but we'll always use light mode
interface ThemeContextType {
  isDarkMode: boolean;
  toggleTheme: () => void; // Kept for compatibility but will do nothing
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Always light mode
  const isDarkMode = false;

  // No-op function for API compatibility
  const toggleTheme = () => {
    // No-op - we're always in light mode
    console.log('Light mode is always enabled in this version');
  };

  return (
    <ThemeContext.Provider value={{ isDarkMode, toggleTheme }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
