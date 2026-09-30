import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = resolve(__dirname, 'shared')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main/index.ts'),
          'epub-worker': resolve(__dirname, 'electron/main/epub/extract.worker.ts')
        }
      }
    },
    resolve: { alias: { '@shared': shared } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: resolve(__dirname, 'electron/preload/index.ts') }
    },
    resolve: { alias: { '@shared': shared } }
  },
  renderer: {
    root: 'src',
    resolve: { alias: { '@shared': shared } },
    plugins: [react()],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/index.html') }
    }
  }
})
