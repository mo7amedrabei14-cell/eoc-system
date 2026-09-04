import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react()
  ],
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        // Vite 8 / Rolldown: manualChunks يجب أن يكون Function
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react-dom') || id.includes('react-router') || /\breact\b/.test(id)) return 'react-vendor';
          if (id.includes('/leaflet/') || id.includes('react-leaflet')) return 'map-vendor';
          if (id.includes('/xlsx/')) return 'xlsx';
          return 'vendor';
        },
      },
    },
  },
})