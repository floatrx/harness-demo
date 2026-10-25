export const usd = (value: number) => `$${value.toFixed(2)}`;

export const duration = (ms: number) => {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} m`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} m`;
};

export const clock = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
