import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react()
  ],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/api'),
      },
      '/token': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        strictExecutionOrder: true,
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [
            { name: 'react-vendor', test: /node_modules[\\/](?:react|react-dom|scheduler|react-router|react-router-dom)[\\/]/, priority: 40 },
            { name: 'map-vendor', test: /node_modules[\\/](?:leaflet|react-leaflet|@react-leaflet)[\\/]/, priority: 30 },
            { name: 'exceljs', test: /node_modules[\\/]exceljs[\\/]/, priority: 30 },
            { name: 'jszip', test: /node_modules[\\/]jszip[\\/]/, priority: 30 },
            { name: 'xlsx', test: /node_modules[\\/]xlsx[\\/]/, priority: 30 },
            { name: 'vendor', test: /node_modules/, priority: 10 },
          ],
        },
      },
    },
  },
})