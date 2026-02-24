import { createContext, useContext, useState, useMemo, useEffect, type ReactNode } from 'react'

const STORAGE_KEY = 'influencer-theme'

export type ThemeMode = 'light' | 'dark' | 'sepia' | 'ocean' | 'contrast'

export const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
  { value: 'sepia', label: 'Sépia' },
  { value: 'ocean', label: 'Oceano' },
  { value: 'contrast', label: 'Alto contraste' },
]

const VALID_THEMES: ThemeMode[] = ['light', 'dark', 'sepia', 'ocean', 'contrast']

function isValidTheme(v: string): v is ThemeMode {
  return VALID_THEMES.includes(v as ThemeMode)
}

interface ThemeContextValue {
  theme: ThemeMode
  setTheme: (mode: ThemeMode) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function readStored(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v && isValidTheme(v)) {
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
    () => () => setThemeState((prev) => {
      const i = VALID_THEMES.indexOf(prev)
      return VALID_THEMES[(i + 1) % VALID_THEMES.length]
    }),
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
