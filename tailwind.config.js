/** @type {import('tailwindcss').Config} */

// The palette is defined once, here, as CSS custom properties in index.css and
// referenced through them — so a colour can be retuned in one place and every
// surface follows, including anything written in raw CSS.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Neutrals: a cold near-black that lets the pixel art sit forward.
        void: 'rgb(var(--void) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        raised: 'rgb(var(--raised) / <alpha-value>)',
        edge: 'rgb(var(--edge) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        faint: 'rgb(var(--faint) / <alpha-value>)',

        // The chrome's own colour: carved bone-gold, for hairlines and the
        // wordmark. Never used for state — see index.css.
        rune: 'rgb(var(--rune) / <alpha-value>)',

        arcane: 'rgb(var(--arcane) / <alpha-value>)',
        ember: 'rgb(var(--ember) / <alpha-value>)',
        tide: 'rgb(var(--tide) / <alpha-value>)',
        gale: 'rgb(var(--gale) / <alpha-value>)',
        stone: 'rgb(var(--stone) / <alpha-value>)',

        good: 'rgb(var(--good) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        bad: 'rgb(var(--bad) / <alpha-value>)',

        // Set per-element by a `data-element` attribute; see index.css.
        element: 'rgb(var(--element) / <alpha-value>)',
      },
      fontFamily: {
        // Display carries the personality; body is a dense, screen-native
        // grotesque that gets out of its way; mono holds every address and
        // every number, which is most of this interface.
        display: ['"Bricolage Grotesque"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"Instrument Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: { xl2: '1.25rem' },
      boxShadow: {
        lift: '0 1px 0 0 rgb(255 255 255 / 0.05) inset, 0 18px 44px -20px rgb(0 0 0 / 0.85)',
        glow: '0 0 34px -8px rgb(var(--element) / 0.55)',
      },
      keyframes: {
        rise: { from: { opacity: '0', transform: 'translateY(10px)' }, to: { opacity: '1', transform: 'none' } },
        pulseRing: {
          '0%': { boxShadow: '0 0 0 0 rgb(var(--element) / 0.5)' },
          '70%': { boxShadow: '0 0 0 14px rgb(var(--element) / 0)' },
          '100%': { boxShadow: '0 0 0 0 rgb(var(--element) / 0)' },
        },
        shake: {
          '0%,100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-6px)' },
          '40%': { transform: 'translateX(5px)' },
          '60%': { transform: 'translateX(-3px)' },
          '80%': { transform: 'translateX(2px)' },
        },
        drift: { from: { transform: 'translateY(0)' }, to: { transform: 'translateY(-8px)' } },
        sweep: { from: { backgroundPosition: '200% 0' }, to: { backgroundPosition: '-200% 0' } },
        // A plain fade, for full-screen overlays. Deliberately a CSS animation
        // rather than a state flip on the frame after mount: a backgrounded tab
        // gets no animation frames, so an overlay that waits for one to raise
        // its opacity opens invisible and stays that way.
        fade: { from: { opacity: '0' }, to: { opacity: '1' } },
        // The strike: a struck panel flashes its element and settles.
        strike: {
          '0%': { boxShadow: '0 0 0 0 rgb(var(--element) / 0.75)' },
          '100%': { boxShadow: '0 0 40px -6px rgb(var(--element) / 0)' },
        },
        // Used on numbers that just changed, so a stat moving is legible.
        tick: {
          '0%': { transform: 'translateY(3px)', opacity: '0' },
          '100%': { transform: 'none', opacity: '1' },
        },
      },
      animation: {
        rise: 'rise .35s cubic-bezier(.2,.7,.3,1) both',
        pulseRing: 'pulseRing 1.8s ease-out infinite',
        shake: 'shake .4s ease-in-out',
        drift: 'drift 2.4s ease-in-out infinite alternate',
        sweep: 'sweep 1.6s linear infinite',
        fade: 'fade .3s ease-out both',
        strike: 'strike .55s ease-out',
        tick: 'tick .28s cubic-bezier(.2,.8,.3,1)',
      },
    },
  },
  plugins: [],
};
