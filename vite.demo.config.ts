import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'demo-dist',
    emptyOutDir: true,
  },
});
