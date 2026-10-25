import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/recharts/') || id.includes('/node_modules/d3-')) return 'charts'
          if (id.includes('/node_modules/leaflet/') || id.includes('/node_modules/react-leaflet/')) return 'maps'
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/') || id.includes('/node_modules/scheduler/') || id.includes('/node_modules/react-router')) return 'framework'
        },
      },
    },
  },
})
