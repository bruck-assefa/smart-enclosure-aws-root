import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  base: '/',
  build: {
    outDir: 'dist',
  },
  server: {
    host: true, // Allows network access
    port: 5173, // Adjust the port if needed
    allowedHosts: ['bruck.gg', 'localhost'] // Add your domain and any other desired hosts
  }
})
