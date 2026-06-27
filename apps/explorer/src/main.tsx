import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
const syncColorScheme = () => document.documentElement.classList.toggle("dark", colorScheme.matches);
syncColorScheme();
colorScheme.addEventListener("change", syncColorScheme);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
