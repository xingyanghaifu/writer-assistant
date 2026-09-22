/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f7f6f3',
          100: '#eeece6',
          200: '#ddd9cf',
          300: '#c4bdad',
          400: '#a79d88',
          500: '#8d826c',
          600: '#736a58',
          700: '#5c5548',
          800: '#4a453c',
          900: '#3a362f',
          950: '#232019'
        },
        paper: {
          DEFAULT: '#f5efe1',
          dark: '#2b2822',
          parch: '#f0e4c8'
        }
      },
      fontFamily: {
        song: ['SimSun', 'Songti SC', 'Noto Serif SC', 'serif'],
        kai: ['KaiTi', 'Kaiti SC', 'STKaiti', 'serif'],
        lora: ['Lora', 'Georgia', 'serif']
      }
    }
  },
  plugins: []
}
