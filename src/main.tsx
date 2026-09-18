import React from "react";
import ReactDOM from "react-dom/client";

// i18n must be imported before any component so the instance is ready.
import "./lib/i18n";
import { App } from "./app";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
