/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  darkMode: 'class', // Enable class-based dark mode
  theme: {
    extend: {
      colors: {
        // Quran app custom colors
        'mushaf-cream': '#F8F4E9', // Light mode background (kertas mushaf)
        'mushaf-dark': '#0C0C0C',  // Dark mode background
        'text-dark': '#1A1A1A',    // Light mode text
        'text-cream': '#E8E2D1',   // Dark mode text
      },
      fontFamily: {
        'uthmanic': ['UthmanicHafs', 'Arial'], // Mushaf font
      },
    },
  },
  plugins: [],
}
