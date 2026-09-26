import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/noto-sans-bengali/bengali-400.css";
import "@fontsource/noto-sans-bengali/bengali-600.css";
import { App } from "./App";
import { applyTheme } from "./theme";
import "./styles.css";

applyTheme();

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
