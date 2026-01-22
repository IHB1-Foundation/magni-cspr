import { FC, useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

const THEME_KEY = 'magni-theme'

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  const stored = localStorage.getItem(THEME_KEY)
  if (stored === 'light' || stored === 'dark') {
    return stored
  }
  return 'dark'
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
}

export const ThemeToggle: FC = () => {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    applyTheme(theme)
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  const cycleTheme = () => {
    setTheme((prev) => {
      if (prev === 'dark') return 'light'
      return 'dark'
    })
  }

  const getIcon = () => {
    if (theme === 'light') return '☀️'
    return '🌙'
  }

  const getLabel = () => {
    if (theme === 'light') return 'Light'
    return 'Dark'
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={cycleTheme}
      title={`Theme: ${getLabel()}. Click to change.`}
      aria-label={`Current theme: ${getLabel()}. Click to change theme.`}
    >
      <span className="theme-toggle-icon" aria-hidden="true">
        {getIcon()}
      </span>
      <span className="theme-toggle-label">{getLabel()}</span>
    </button>
  )
}

// Hook for other components to access theme
export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void } {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    applyTheme(theme)
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  return { theme, setTheme }
}

export default ThemeToggle
