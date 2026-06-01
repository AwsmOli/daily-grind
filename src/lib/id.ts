export const randomToken = (size = 8): string => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let token = "";

  for (let i = 0; i < size; i += 1) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }

  return token;
};
