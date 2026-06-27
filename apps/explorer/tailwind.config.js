/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        page:    { light: "#FAFAF7", dark: "#0B0E13" },
        surface: { light: "#FFFFFF", dark: "#11151C" },
        line:    { light: "#E5E5E0", dark: "rgba(255,255,255,0.10)" },
        ink:     { light: "#16181D", dark: "#F8FAFC" },
        muted:   { light: "#6B6B6B", dark: "#94A3B8" },
        dim:     { light: "#9A9893", dark: "#64748B" },
        accent:  "#185FA5",
        warning: "#BA7517",
        danger:  "#A32D2D",
        success: "#3B6D11",
        violet:  "#534AB7"
      },
      fontFamily: {
        serif: ["'Source Serif Pro'", "'Source Serif 4'", "Georgia", "serif"],
        sans:  ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono:  ["'IBM Plex Mono'", "ui-monospace", "monospace"]
      },
      letterSpacing: {
        eyebrow: "0.06em"
      },
      fontSize: {
        eyebrow: ["10px", { lineHeight: "1.2", letterSpacing: "0.06em" }],
        body:    ["13.5px", { lineHeight: "1.55" }],
        meta:    ["12px", { lineHeight: "1.4" }],
        name:    ["16px", { lineHeight: "1.2", letterSpacing: "-0.005em" }]
      }
    }
  },
  plugins: []
};
