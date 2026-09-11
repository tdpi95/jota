// Mirror of server/src/services/projects.ts's `COLOR_PALETTE` — the fixed
// 12-color set the server auto-assigns from. The client never invents its
// own colors (PLAN.md "Color": "never left to client-side hashing"); this
// copy exists only to drive the color-picker's swatch choices in
// `ProjectForm` — the color a project actually has always comes from its
// frontmatter, read from the server.
export const COLOR_PALETTE = [
  '#4f86f7',
  '#f7674f',
  '#42c186',
  '#f7a94f',
  '#9b6ff7',
  '#4fc7f7',
  '#f74f9b',
  '#8ac24f',
  '#f7d24f',
  '#6f7bf7',
  '#4ff7d2',
  '#c1424f',
];
