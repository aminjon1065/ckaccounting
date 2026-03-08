/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./lib/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#0a7ea4",
          foreground: "#ffffff",
          50: "#f0f9ff",
          100: "#e0f4fb",
          200: "#bae8f5",
          500: "#0a7ea4",
          600: "#0870910",
          700: "#065873",
        },
        destructive: {
          DEFAULT: "#ef4444",
          foreground: "#ffffff",
        },
        success: {
          DEFAULT: "#22c55e",
          foreground: "#ffffff",
          50: "#f0fdf4",
          100: "#dcfce7",
        },
        warning: {
          DEFAULT: "#f59e0b",
          foreground: "#ffffff",
          50: "#fffbeb",
          100: "#fef3c7",
        },
      },
      borderRadius: {
        "2xl": "16px",
        "3xl": "24px",
      },
    },
  },
  plugins: [],
};
