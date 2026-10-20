// Theme registry shared by the main window and the widget. Colors here only drive the
// preview cards; the real tokens live in styles.css under [data-theme="..."].
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Themes = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const THEMES = [
    { id: "dark", name: "다크", desc: "차분한 그래파이트", dark: true, bg: "#0e0f13", side: "#121318", surface: "#17181e", fg: "#ecedf2", accent: "#7c83ff", accent2: "#b07cff" },
    { id: "light", name: "화이트", desc: "깨끗한 기본 밝은 화면", dark: false, bg: "#f5f6f8", side: "#fbfbfc", surface: "#ffffff", fg: "#15161c", accent: "#5b5bf6", accent2: "#9b5cf6" },
    { id: "midnight", name: "미드나잇", desc: "깊은 밤하늘과 하늘색", dark: true, bg: "#0a0f1e", side: "#0d1325", surface: "#111a30", fg: "#e6edff", accent: "#38bdf8", accent2: "#818cf8" },
    { id: "forest", name: "포레스트", desc: "숲속 같은 초록", dark: true, bg: "#0b120f", side: "#0e1713", surface: "#121d18", fg: "#e3efe8", accent: "#34d399", accent2: "#a3e635" },
    { id: "sunset", name: "선셋", desc: "노을빛 코랄과 오렌지", dark: true, bg: "#140d12", side: "#191017", surface: "#1f141c", fg: "#f7e9ef", accent: "#fb7185", accent2: "#fb923c" },
    { id: "mocha", name: "모카", desc: "따뜻한 커피 브라운", dark: true, bg: "#14110f", side: "#181412", surface: "#1e1a17", fg: "#f1e8e1", accent: "#d6a26b", accent2: "#e8c39e" },
    { id: "lavender", name: "라벤더", desc: "은은한 보라빛", dark: false, bg: "#f6f4fe", side: "#faf9ff", surface: "#ffffff", fg: "#1d1730", accent: "#7c5cf6", accent2: "#c06cf0" },
    { id: "ocean", name: "오션", desc: "시원한 청록 바다", dark: false, bg: "#f1f7f8", side: "#f7fbfc", surface: "#ffffff", fg: "#0f1f24", accent: "#0e9fa8", accent2: "#3b82f6" },
    { id: "sakura", name: "벚꽃", desc: "봄날의 분홍", dark: false, bg: "#fdf4f6", side: "#fff8fa", surface: "#ffffff", fg: "#2a1820", accent: "#e0457b", accent2: "#f59e9e" },
    { id: "mono", name: "모노", desc: "흑백으로 단정하게", dark: false, bg: "#f4f4f5", side: "#fafafa", surface: "#ffffff", fg: "#09090b", accent: "#18181b", accent2: "#52525b" },
  ];
  const byId = (id) => THEMES.find((t) => t.id === id) || THEMES[0];
  return { THEMES, byId };
});
