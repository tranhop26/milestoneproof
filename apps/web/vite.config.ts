import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  build: {
    // GenLayerJS includes its Viem transport and calldata codecs in the browser client.
    chunkSizeWarningLimit: 850,
  },
})
