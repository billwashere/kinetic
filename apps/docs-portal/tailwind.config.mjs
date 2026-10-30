export default {
  content: ['./src/**/*.{astro,tsx}'],
  // Toggled by the header button; the initial class is set before first paint from storage or the OS setting.
  darkMode: 'class',
  plugins: [require('@tailwindcss/typography')],
};
