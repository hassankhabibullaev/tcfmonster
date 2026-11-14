export const looksLikeKey = (k: string) => /^(AIza|AQ\.)/.test(k) && !/\s/.test(k) && k.length >= 30;
