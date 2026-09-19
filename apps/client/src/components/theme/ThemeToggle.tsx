import { FaDesktop, FaMoon, FaSun } from "react-icons/fa";

import type { Theme } from "@/types/Theme";

import { useTheme } from "@/hooks/useTheme";

const NEXT_THEMES: Record<Theme, Theme> = {
  system: "light",
  light: "dark",
  dark: "system",
};

const THEME_CONFIG: Record<Theme, { icon: typeof FaDesktop; label: string }> = {
  system: { icon: FaDesktop, label: "System" },
  light: { icon: FaSun, label: "Light" },
  dark: { icon: FaMoon, label: "Dark" },
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const currentTheme = THEME_CONFIG[theme];
  const Icon = currentTheme.icon;

  const handleCycleTheme = () => {
    setTheme(NEXT_THEMES[theme]);
  };

  return (
    <button
      type="button"
      onClick={handleCycleTheme}
      className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-outline-variant bg-surface-container/60 hover:bg-surface-container-high transition-colors text-xs font-medium text-on-surface-variant hover:text-on-surface font-label focus:outline-none focus:ring-1 focus:ring-primary shadow-xs cursor-pointer"
      aria-label={`Theme: ${currentTheme.label}. Click to switch.`}
      title={`Theme: ${currentTheme.label} (click to switch)`}
    >
      <Icon size={12} className="text-primary shrink-0" aria-hidden="true" />
      <span>{currentTheme.label}</span>
    </button>
  );
}
