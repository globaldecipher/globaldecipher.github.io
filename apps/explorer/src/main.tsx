import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

function syncTheme() {
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  const meta = document.getElementById("theme-color-meta") as HTMLMetaElement | null;
  if (meta) meta.content = isDark ? "#0f1318" : "#fafaf7";
}
syncTheme();
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncTheme);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
