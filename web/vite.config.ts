import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Keep the renderer dependency isolated so the app shell remains small.
        manualChunks: (id) => (id.includes('/node_modules/three/') ? 'three' : undefined),
      },
    },
  },
  server: {
    proxy: {
      // 직접 좌표 열의 /api 요청을 Spring Boot 백엔드로 전달한다.
      // 큐레이션 열은 /data 정적 JSON만 쓰므로 백엔드 없이도 동작한다.
      '/api': 'http://localhost:8080',
    },
  },
})
