import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages: https://aqedah.github.io/CBAO/ 아래에 배포되므로 base 를 저장소 이름으로 둔다.
// 로컬 개발/미리보기도 같은 경로를 쓴다 (http://localhost:5173/CBAO/).
export default defineConfig({
  base: '/CBAO/',
  plugins: [react()],
})
