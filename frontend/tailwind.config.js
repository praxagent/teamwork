/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class', // Enable class-based dark mode
  theme: {
    extend: {
      colors: {
        // Modern neutral + accent palette
        'tw-bg': '#0f1117',
        'tw-surface': '#161821',
        'tw-border': '#232530',
        'tw-accent': '#6366f1',
        'tw-accent-hover': '#818cf8',
        'tw-badge': '#f43f5e',
      },
      fontFamily: {
        'sans': ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
