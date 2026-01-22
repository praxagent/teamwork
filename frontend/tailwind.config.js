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
        // Slack-inspired color palette
        'slack-purple': '#4A154B',
        'slack-purple-light': '#611f69',
        'slack-aubergine': '#3F0E40',
        'slack-sidebar': '#19171D',
        'slack-hover': '#350d36',
        'slack-active': '#1164A3',
        'slack-green': '#2BAC76',
        'slack-yellow': '#ECB22E',
        'slack-red': '#E01E5A',
      },
      fontFamily: {
        'slack': ['Lato', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
