import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // 관리자가 설정하는 공연별 강조색 (런타임 CSS 변수)
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          fg: "rgb(var(--accent-fg) / <alpha-value>)",
          soft: "rgb(var(--accent) / 0.12)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
