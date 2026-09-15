import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 纯前端构建：不注入任何外部在线地址
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
});
