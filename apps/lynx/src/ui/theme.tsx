import { createContext, useContext, useMemo, type ReactNode } from "@lynx-js/react";

export interface ThemeColors {
  // Brand & Accents
  brand: string;
  brandGlow: string;
  accent: string;
  accentPhosphor: string;
  accentMagenta: string;
  accentAmber: string;

  // Background surfaces
  background: string;
  surface: string;
  surfaceSubtle: string;
  surfaceRaised: string;
  surfaceOverlay: string;

  // Borders & Lines
  border: string;
  borderSubtle: string;
  borderFocus: string;

  // Text & Typography
  text: string;
  textMuted: string;
  textSubtle: string;
  textInverse: string;

  // Status & Feedback
  statusOk: string;
  statusWarn: string;
  statusError: string;
  statusInfo: string;
}

export interface ThemeSpacing {
  none: string;
  xxsmall: string;
  xsmall: string;
  small: string;
  medium: string;
  large: string;
  xlarge: string;
  xxlarge: string;
}

export interface ThemeRadius {
  none: string;
  xsmall: string;
  small: string;
  medium: string;
  large: string;
  full: string;
}

export interface ThemeTypography {
  fontFamily: string;
  monoFontFamily: string;
  sizes: {
    xsmall: string;
    small: string;
    medium: string;
    large: string;
    xlarge: string;
    xxlarge: string;
    title: string;
  };
}

export interface Theme {
  colors: ThemeColors;
  spacing: ThemeSpacing;
  radii: ThemeRadius;
  typography: ThemeTypography;
  elevation: {
    none: string;
    small: string;
    medium: string;
    large: string;
    glow: string;
  };
}

export const defaultTheme: Theme = {
  colors: {
    brand: "#57E6FF",
    brandGlow: "rgba(87, 230, 255, 0.25)",
    accent: "#00FF9D",
    accentPhosphor: "#00FF9D",
    accentMagenta: "#B388FF",
    accentAmber: "#FFB800",

    background: "#070910",
    surface: "#101522",
    surfaceSubtle: "#171D2E",
    surfaceRaised: "#1F283D",
    surfaceOverlay: "rgba(7, 9, 16, 0.88)",

    border: "#2A3652",
    borderSubtle: "#1A2234",
    borderFocus: "#57E6FF",

    text: "#E8F0FF",
    textMuted: "#8792AA",
    textSubtle: "#5A657D",
    textInverse: "#070910",

    statusOk: "#00FF9D",
    statusWarn: "#FFB800",
    statusError: "#FF4D6D",
    statusInfo: "#57E6FF"
  },
  spacing: {
    none: "0px",
    xxsmall: "2px",
    xsmall: "4px",
    small: "8px",
    medium: "12px",
    large: "16px",
    xlarge: "24px",
    xxlarge: "32px"
  },
  radii: {
    none: "0px",
    xsmall: "2px",
    small: "4px",
    medium: "6px",
    large: "8px",
    full: "9999px"
  },
  typography: {
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    monoFontFamily: "ui-monospace, Menlo, Consolas, Monaco, monospace",
    sizes: {
      xsmall: "10px",
      small: "12px",
      medium: "14px",
      large: "16px",
      xlarge: "18px",
      xxlarge: "22px",
      title: "28px"
    }
  },
  elevation: {
    none: "none",
    small: "0 2px 8px rgba(0,0,0,0.4)",
    medium: "0 6px 20px rgba(0,0,0,0.6)",
    large: "0 12px 40px rgba(0,0,0,0.8)",
    glow: "0 0 16px rgba(87, 230, 255, 0.3)"
  }
};

const ThemeContext = createContext<Theme>(defaultTheme);

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export interface ThemeProviderProps {
  theme?: Partial<Theme>;
  children?: ReactNode;
}
export function ThemeProvider({ theme, children }: ThemeProviderProps) {
  const mergedTheme = useMemo(() => {
    if (!theme) return defaultTheme;
    return {
      colors: { ...defaultTheme.colors, ...theme.colors },
      spacing: { ...defaultTheme.spacing, ...theme.spacing },
      radii: { ...defaultTheme.radii, ...theme.radii },
      typography: { ...defaultTheme.typography, ...theme.typography },
      elevation: { ...defaultTheme.elevation, ...theme.elevation }
    };
  }, [theme]);

  return <ThemeContext.Provider value={mergedTheme}>{children}</ThemeContext.Provider>;
}
