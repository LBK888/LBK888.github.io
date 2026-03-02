/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                primary: "#6366f1", // Indigo 500
                secondary: "#ec4899", // Pink 500
                dark: "#1e293b", // Slate 800
                light: "#f8fafc", // Slate 50
                accent: "#8b5cf6", // Violet 500
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
                cjk: ['"Noto Sans TC"', '"Microsoft JhengHei"', 'sans-serif'],
            }
        },
    },
    plugins: [],
}
