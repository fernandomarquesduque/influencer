import { createContext, useContext, useState, useMemo, useEffect, type ReactNode } from 'react'

const STORAGE_KEY = 'influencer-theme'

export type ThemeMode = 'light' | 'dark'

interface ThemeContextValue {
  theme: ThemeMode
  setTheme: (mode: ThemeMode) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function readStored(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'dark' || v === 'light') {
      if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', v)
      return v
    }
  } catch {
    // ignore
  }
  if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', 'light')
  return 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(readStored)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, theme)
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const setTheme = useMemo(
    () => (mode: ThemeMode) => setThemeState(mode),
    []
  )

  const toggleTheme = useMemo(
    () => () => setThemeState((prev) => (prev === 'light' ? 'dark' : 'light')),
    []
  )

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme]
  )

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
