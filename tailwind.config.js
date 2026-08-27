/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        night: {
          950: "#03060d",
          900: "#060a16",
          800: "#0b1120",
          700: "#131b2e",
        },
        accent: {
          DEFAULT: "#3D5AFE",
          50: "#EEF1FF",
          100: "#DCE2FF",
          400: "#6B82FF",
          500: "#3D5AFE",
          600: "#2F46D1",
          700: "#23348C",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      backgroundImage: {
        "grid-glow":
          "radial-gradient(circle at 20% 0%, rgba(61,90,254,0.07), transparent 45%), radial-gradient(circle at 90% 10%, rgba(61,90,254,0.05), transparent 40%)",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(61,90,254,0.12), 0 8px 32px -8px rgba(61,90,254,0.25)",
        card: "0 1px 2px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.06)",
      },
      keyframes: {
        "spin-slow": { to: { transform: "rotate(360deg)" } },
        "spin-slow-reverse": { to: { transform: "rotate(-360deg)" } },
        "pulse-soft": {
          "0%, 100%": { opacity: 1 },
          "50%": { opacity: 0.4 },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-6px)" },
        },
        "fade-in-up": {
          "0%": { opacity: 0, transform: "translateY(16px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: 0 },
          "100%": { opacity: 1 },
        },
        "scale-in": {
          "0%": { opacity: 0, transform: "scale(0.94)" },
          "100%": { opacity: 1, transform: "scale(1)" },
        },
        "splash-out": {
          "0%": { opacity: 1 },
          "70%": { opacity: 1 },
          "100%": { opacity: 0, visibility: "hidden" },
        },
      },
      animation: {
        "spin-slow": "spin-slow 40s linear infinite",
        "spin-slower": "spin-slow 90s linear infinite",
        "spin-slow-reverse": "spin-slow-reverse 60s linear infinite",
        "pulse-soft": "pulse-soft 3s ease-in-out infinite",
        float: "float 4s ease-in-out infinite",
        "fade-in-up": "fade-in-up 0.7s cubic-bezier(0.16, 1, 0.3, 1) both",
        "fade-in": "fade-in 0.8s ease-out both",
        "scale-in": "scale-in 0.8s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};
