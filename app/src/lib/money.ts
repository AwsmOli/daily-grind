export const majorToMinor = (value: string | number): number => {
  const numeric = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numeric)) return 0;

  return Math.round(numeric * 100);
};

export const minorToMajor = (minor: number): string => {
  const normalized = Number.isFinite(minor) ? minor : 0;
  return (normalized / 100).toFixed(2);
};

export const formatMinor = (minor: number, symbol = ""): string => {
  const amount = minorToMajor(minor);
  return symbol ? `${symbol}${amount}` : amount;
};
