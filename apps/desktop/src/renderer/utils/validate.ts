export const isPhone = (value: string) => /^1\d{10}$/.test(value);
export const isValidPassword = (value: string) => value.length >= 6;
