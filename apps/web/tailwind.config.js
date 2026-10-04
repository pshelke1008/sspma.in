/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1rem' },
    extend: {
      colors: {
        // CAThrives palette: #0866FF blue on a cool grey canvas with navy ink.
        brand: {
          // Deeper than the fill so blue text clears 4.5:1 on white and on brand-light.
          DEFAULT: '#0657D6',
          dark: '#0548B3',
          primary: '#0866FF',
          light: '#EFF6FF',
        },
        accent: {
          DEFAULT: '#F59E0B',
          light: '#FFF7E6',
          // Amber text: #F59E0B is 2.1:1 on white, so amounts and counts use
          // this deeper shade (5.0:1) and the bright one stays for fills.
          ink: '#B45309',
        },
        ink: {
          DEFAULT: '#1B2232',
          // Clears 4.5:1 on both white and the canvas background.
          muted: '#626F84',
        },
        line: '#DCE0E6',
        canvas: '#F5F7FA',
        // CAThrives' sidebar sits on a warm off-white, apart from the cool canvas.
        sidebar: '#F7F7F5',
        // Status colours carry small text and sit behind white button labels,
        // so each is the nearest accessible shade of the base palette value.
        success: '#217B67',
        warning: '#E9A23B',
        danger: '#C33C45',
        info: '#2E6BCA',
      },
      fontFamily: {
        // Inter has no Devanagari; Mukta covers Marathi glyphs and matches Inter's weight range.
        sans: ['Inter', 'Mukta', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        card: '6px',
        control: '6px',
      },
      boxShadow: {
        card: '0 1px 3px 0 rgba(27, 38, 54, 0.06), 0 1px 2px -1px rgba(27, 38, 54, 0.06)',
        raised: '0 4px 6px -1px rgba(27, 38, 54, 0.08), 0 2px 4px -2px rgba(27, 38, 54, 0.05)',
        pop: '0 10px 15px -3px rgba(27, 38, 54, 0.1), 0 4px 6px -4px rgba(27, 38, 54, 0.05)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
        'slide-up': 'slide-up 180ms ease-out',
        'slide-in-right': 'slide-in-right 200ms ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
