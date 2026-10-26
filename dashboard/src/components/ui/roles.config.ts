/* Stable identity per agent role: a two-letter monogram on a tint of its own hue. */
export const ROLE_IDENTITY: Record<string, { label: string; hue: number }> = {
  writer: { label: 'Wr', hue: 215 },
  explorer: { label: 'Ex', hue: 185 },
  planner: { label: 'Pl', hue: 160 },
  designer: { label: 'Ds', hue: 315 },
  tester: { label: 'Ts', hue: 48 },
  implementer: { label: 'Im', hue: 130 },
  debugger: { label: 'Db', hue: 22 },
  qa: { label: 'QA', hue: 95 },
  judge: { label: 'Jd', hue: 350 },
};
