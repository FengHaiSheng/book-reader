import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = resolve(__dirname, 'shared')

export default defineConfig({
  main: {
    // 解析 Kindle/FB2 的两个包必须打进 worker：它们只有纯 ESM 的 node 构建，
    // 留在 asar 外按 Node 规则解析反而更容易在打包后找不到。
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@lingo-reader/mobi-parser', '@lingo-reader/fb2-parser']
      })
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main/index.ts'),
          'epub-worker': resolve(__dirname, 'electron/main/epub/extract.worker.ts'),
          'pdf-worker': resolve(__dirname, 'electron/main/pdf/extract.worker.ts'),
          'kindle-worker': resolve(__dirname, 'electron/main/kindle/extract.worker.ts')
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
