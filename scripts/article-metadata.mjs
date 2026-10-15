export function plainText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}


export function countArticleWords(html) {
  const body = plainText(html)
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (entity, value) => {
      const point = value[0].toLowerCase() === "x" ? parseInt(value.slice(1), 16) : Number(value);
      return point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    });
  // Count each Han character and each remaining word/number as one unit.
  return (body.match(/\p{Script=Han}|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || []).length;
}
