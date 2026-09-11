import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    // §7.1 红线：禁止静默漂移端口。冲突必须大声失败（旧实例未退出的信号），
    // 绝不自动往后挪——漂移会掩盖僵尸进程，让页面绑错服务器。
    strictPort: true,
  },
  build: {
    // 纯静态输出目录，未来直接作为 Tauri 的 frontendDist
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // vendor 手动分包：只切顶层入口包，传递依赖交给默认分包算法
        // （此前按传递依赖枚举曾导致 chunk 循环，改回入口粒度后消除）。
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          // markdown 生态只认两个入口：其传递依赖（unified/micromark/mdast…）
          // 仅被它们引用时会自动并入 markdown 块，多处共享时走默认共享块
          if (id.includes('/react-markdown/') || id.includes('/remark-gfm/')) {
            return 'markdown';
          }
          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/scheduler/')
          ) {
            return 'react';
          }
          if (id.includes('/node_modules/@tanstack/')) return 'query';
          if (id.includes('/node_modules/framer-motion/')) return 'motion';
          if (id.includes('/node_modules/lucide-react/')) return 'icons';
          if (id.includes('/node_modules/@base-ui-components/')) return 'baseui';
          if (id.includes('/node_modules/hono/')) return 'hono';
          if (id.includes('/node_modules/zustand/')) return 'zustand';
          if (id.includes('/node_modules/sonner/')) return 'sonner';
          if (id.includes('/node_modules/canvas-confetti/')) return 'confetti';
          return undefined;
        },
      },
    },
  },
});

