/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: {
          950: '#08090c',
          900: '#0c0e13',
          850: '#10131a',
          800: '#151922',
          700: '#1d222d',
          600: '#2a303d',
          500: '#3c4453',
        },
        accent: {
          500: '#5b8cff',
          400: '#7aa2ff',
          300: '#a3c0ff',
        },
        signal: {
          listening: '#4ade80',
          thinking: '#facc15',
          speaking: '#5b8cff',
          interrupted: '#f97316',
          error: '#ef4444',
        },
      },
      fontFamily: {
        sans: ['"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        glass: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 0 0 1px rgba(255,255,255,0.03)',
      },
      keyframes: {
        pulseSlow: {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        pulseSlow: 'pulseSlow 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
