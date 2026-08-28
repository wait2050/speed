import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 部署在子路径时由环境变量 BASE_PATH 覆盖，例如 BASE_PATH=/speed/
export default defineConfig({
  base: process.env.BASE_PATH || './',
  plugins: [react()],
  server: {
    host: true,
  },
})