import { createContext } from "react";

import type { ThemeContextType } from "../types/Theme";

export const ThemeContext = createContext<ThemeContextType | null>(null);
