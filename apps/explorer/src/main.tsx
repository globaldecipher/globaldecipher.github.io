import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

type Theme = "light" | "dark";

const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");

function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem("tgd-theme");
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.dataset.theme = theme;
  const meta = document.getElementById("theme-color-meta") as HTMLMetaElement | null;
  if (meta) meta.content = theme === "dark" ? "#0f1318" : "#f7f5ef";
}

applyTheme(storedTheme() ?? (themeMedia.matches ? "dark" : "light"));
themeMedia.addEventListener("change", (event) => {
  if (!storedTheme()) applyTheme(event.matches ? "dark" : "light");
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
