/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves this project site from https://<user>.github.io/uri-amiram-archive/
// Override with BASE_PATH=/ for a custom domain or root hosting.
const base = process.env.BASE_PATH ?? '/uri-amiram-archive/'

export default defineConfig({
  base,
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
