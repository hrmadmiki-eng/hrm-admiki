export default {
  content: { relative: true, files: ['./index.html', './src/**/*.{js,jsx}'] },
  theme: {
    extend: {
      colors: {
        forest: {
          50: '#edf7f1',
          100: '#d8eee1',
          600: '#208062',
          700: '#176b51',
          800: '#155640',
          900: '#153e30',
        },
      },
      fontFamily: { sans: ['Inter', 'Segoe UI', 'sans-serif'] },
      boxShadow: { card: '0 2px 8px rgba(21,62,48,0.025)' },
    },
  },
  plugins: [],
};
