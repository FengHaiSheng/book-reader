/**
 * 章节文档的内容安全策略。
 *
 * 书是外来文件——执行它等于允许任意代码在渲染进程里跑，所以这一层必须最严：
 * 只留样式与静态资源，脚本、表单、网络连接、嵌套框架一律关死。
 *
 * 两处在用，必须是同一份字符串：
 * - `epub://` 返回 xhtml 时的响应头（挡住「万一被直接导航过去」）；
 * - 注入章节文档 head 的 <meta http-equiv="Content-Security-Policy">。
 */
export const CHAPTER_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline' epub:",
  "img-src epub: data: blob:",
  "font-src epub: data:",
  "media-src epub: blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri epub:"
].join('; ')
