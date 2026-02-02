/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        lab: {
          bg: '#09090b',
          panel: '#18181b',
          border: '#27272a',
          muted: '#a1a1aa',
          accent: '#22c55e',
          violet: '#7c3aed',
        },
      },
    },
  },
  plugins: [],
};

