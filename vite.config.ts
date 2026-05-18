import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'

// Плагин для генерации version.json при билде
function versionPlugin(): Plugin {
  return {
    name: 'version-plugin',
    writeBundle() {
      const buildTime = new Date().toISOString()
      // Уникальный ID версии на основе времени
      const version = `${Date.now()}`
      
      // Попробуем получить git commit hash
      let commitHash = ''
      try {
        commitHash = execSync('git rev-parse --short HEAD').toString().trim()
      } catch {
        commitHash = 'unknown'
      }

      const versionInfo = {
        version,
        buildTime,
        commitHash
      }

      // Записываем в dist/version.json
      fs.writeFileSync(
        path.resolve(__dirname, 'dist', 'version.json'),
        JSON.stringify(versionInfo, null, 2)
      )
      
      console.log(`\n📦 Version info generated: ${version} (${commitHash})`)
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), versionPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      // /api проксируется на прод — vercel dev не запускается из-за 171 endpoint > 128 builds limit
      '/api': {
        target: 'https://www.gfsupport.uz',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
