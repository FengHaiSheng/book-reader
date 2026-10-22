/**
 * 生成章节文档的公共外壳。各格式解析出来的都只是 body 片段，
 * 统一套上最小的 XHTML 骨架，协议层与阅读器才能按同一套规则处理。
 */
export function wrapXhtml(body: string, title = ''): string {
  if (/<html[\s>]/i.test(body)) return body
  return [
    '<!DOCTYPE html>',
    '<html xmlns="http://www.w3.org/1999/xhtml">',
    `<head><meta charset="utf-8"/><title>${escapeHtml(title)}</title></head>`,
    `<body>${body}</body>`,
    '</html>'
  ].join('\n')
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
