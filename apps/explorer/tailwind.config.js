/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        page:    { light: "#f7f5ef", dark: "#0f1318" },
        surface: { light: "#fcfbf7", dark: "#171d24" },
        paper2:  { light: "#efede6", dark: "#171d24" },
        paper3:  { light: "#e5e1d7", dark: "#202832" },
        line:    { light: "#d2cec3", dark: "#303843" },
        line2:   { light: "#aaa598", dark: "#46505c" },
        ink:     { light: "#0d1b2a", dark: "#f2f0ea" },
        ink2:    { light: "#1a2a3a", dark: "#e5e0d5" },
        text:    { light: "#1a1a1a", dark: "#ede9df" },
        muted:   { light: "#6b6b66", dark: "#9e9588" },
        dim:     { light: "#9a9a93", dark: "#756f66" },
        accent:  { DEFAULT: "#b91c2c", dark: "#ff6b7a" },
        warning: "#a17328",
        danger:  "#A32D2D",
        success: "#3B6D11",
        violet:  "#534AB7",
        gold:    "#a17328"
      },
      fontFamily: {
        serif: ["'Source Serif 4'", "Georgia", "'Times New Roman'", "serif"],
        sans:  ["'IBM Plex Sans'", "ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "'Segoe UI'", "Arial", "sans-serif"],
        mono:  ["'IBM Plex Mono'", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"]
      },
      letterSpacing: {
        eyebrow: "0.06em"
      },
      fontSize: {
        eyebrow: ["10px", { lineHeight: "1.2", letterSpacing: "0.06em" }],
        body:    ["15px", { lineHeight: "1.6" }],
        meta:    ["12px", { lineHeight: "1.4" }],
        name:    ["16px", { lineHeight: "1.2", letterSpacing: "-0.005em" }]
      },
      borderRadius: {
        editorial: "2px",
        "editorial-lg": "6px"
      },
      boxShadow: {
        editorial: "0 1px 3px rgba(13, 27, 42, 0.05)",
        "editorial-md": "0 12px 40px rgba(13, 27, 42, 0.12)",
        "editorial-lg": "0 24px 60px rgba(13, 27, 42, 0.18)"
      }
    }
  },
  plugins: []
};
