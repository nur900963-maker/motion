import type { Config } from 'tailwindcss';
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#050505',
        panel: '#0b0b0c',
        line: '#1e1e21',
        accent: '#1fc8ee',
        paper: '#ededeb',
      },
      fontFamily: { sans: ['Geist', 'Inter', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
} satisfies Config;
