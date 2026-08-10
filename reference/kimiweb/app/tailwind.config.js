/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        /* Lumina design tokens — design.md §3 */
        paper: "#FAF6EF",
        cream: "#F2EBE0",
        surface: "#FFFEFB",
        ink: {
          DEFAULT: "#2A211A",
          soft: "#6E5F50",
          faint: "#A3937F",
        },
        line: {
          DEFAULT: "#E7DDCF",
          strong: "#D8CCB9",
        },
        clay: {
          DEFAULT: "#B4552B",
          deep: "#9A4523",
          tint: "#F6E3D6",
        },
        olive: {
          DEFAULT: "#7C8054",
          tint: "#E8EBDA",
        },
        amber: {
          DEFAULT: "#B97F22",
          tint: "#F6EAD2",
        },
        rust: {
          DEFAULT: "#B3402F",
          tint: "#F5DFDB",
        },
        night: "#241C15",
        /* Service category trios — design.md §3.2 */
        cat: {
          nails: { fill: "#F3DFDA", line: "#C97F72", text: "#7C3F35" },
          hair: { fill: "#F1E5C9", line: "#BE9334", text: "#6F5313" },
          lashes: { fill: "#E5E9D8", line: "#87936B", text: "#4B552F" },
          spa: { fill: "#E9E2D6", line: "#9C8E78", text: "#5C5140" },
        },
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xs: "calc(var(--radius) - 6px)",
        /* Lumina radii — design.md §5 */
        "r-sm": "6px",
        "r-md": "10px",
        "r-lg": "14px",
        "r-xl": "20px",
        "r-pill": "999px",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        /* Warm-tinted elevation — design.md §5 */
        "sh-1": "0 1px 2px rgba(42,33,26,.06), 0 1px 6px rgba(42,33,26,.04)",
        "sh-2": "0 4px 12px rgba(42,33,26,.08), 0 2px 4px rgba(42,33,26,.05)",
        "sh-3": "0 16px 40px rgba(42,33,26,.14), 0 4px 12px rgba(42,33,26,.06)",
        "block-drag": "0 12px 28px rgba(42,33,26,.22)",
      },
      fontFamily: {
        display: ["Fraunces", "Georgia", "serif"],
        sans: ["Manrope", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      fontSize: {
        micro: ["10.5px", { lineHeight: "14px", letterSpacing: "0.08em" }],
        small: ["12.5px", { lineHeight: "18px" }],
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.22, 1, 0.36, 1)",
        "in-expo": "cubic-bezier(0.64, 0, 0.78, 0)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%": { opacity: "0" },
        },
        "float-y": {
          "0%,100%": { transform: "translateY(-6px)" },
          "50%": { transform: "translateY(6px)" },
        },
        "scroll-cue": {
          "0%": { transform: "scaleY(0)", transformOrigin: "top" },
          "45%": { transform: "scaleY(1)", transformOrigin: "top" },
          "55%": { transform: "scaleY(1)", transformOrigin: "bottom" },
          "100%": { transform: "scaleY(0)", transformOrigin: "bottom" },
        },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgba(180,85,43,.22)" },
          "70%": { boxShadow: "0 0 0 10px rgba(180,85,43,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(180,85,43,0)" },
        },
        "col-drift": {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        "bracket-bob": {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-4px)" },
        },
        "accept-pulse": {
          "0%,100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.08)" },
        },
        "shimmer": {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
        "float-y": "float-y 4.5s ease-in-out infinite",
        "scroll-cue": "scroll-cue 1.8s cubic-bezier(0.22,1,0.36,1) infinite",
        "pulse-ring": "pulse-ring 2.8s ease-out infinite",
        "col-drift": "col-drift 18s linear infinite",
        "bracket-bob": "bracket-bob 3s ease-in-out infinite",
        "accept-pulse": "accept-pulse 1.8s ease-in-out infinite",
        "shimmer": "shimmer 1.4s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
