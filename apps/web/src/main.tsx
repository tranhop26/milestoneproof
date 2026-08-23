import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"

import { App } from "./App"
import "./index.css"
import { WalletProvider } from "./lib/wallet"

const root = document.getElementById("root")
if (!root) throw new Error("Application root element is missing")

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <WalletProvider>
        <App />
      </WalletProvider>
    </BrowserRouter>
  </StrictMode>,
)
