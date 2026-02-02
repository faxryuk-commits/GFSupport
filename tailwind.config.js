/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          blue: '#3b82f6',
          darkBlue: '#1e3a5f',
          navy: '#1e293b',
        }
      }
    },
  },
  plugins: [],
}
