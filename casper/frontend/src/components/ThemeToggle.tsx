import { FC, useEffect, useState } from 'react'

type Theme = 'light' | 'dark' | 'system'

const THEME_KEY = 'magni-theme'

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'system'
  const stored = localStorage.getItem(THEME_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored
  }
  return 'system'
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  const resolved = theme === 'system' ? getSystemTheme() : theme
  root.setAttribute('data-theme', resolved)
}

export const ThemeToggle: FC = () => {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    applyTheme(theme)
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  // Listen for system theme changes
  useEffect(() => {
    if (theme !== 'system') return

    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const handleChange = () => applyTheme('system')
    mq.addEventListener('change', handleChange)
    return () => mq.removeEventListener('change', handleChange)
  }, [theme])

  const cycleTheme = () => {
    setTheme((prev) => {
      if (prev === 'dark') return 'light'
      if (prev === 'light') return 'system'
      return 'dark'
    })
  }

  const getIcon = () => {
    if (theme === 'light') return '☀️'
    if (theme === 'dark') return '🌙'
    return '⚙️'
  }

  const getLabel = () => {
    if (theme === 'light') return 'Light'
    if (theme === 'dark') return 'Dark'
    return 'System'
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
