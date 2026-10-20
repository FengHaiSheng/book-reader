import { writeFileSync } from 'node:fs'

/**
 * 生成一个最小的多页 PDF（标准 Helvetica，ASCII 文本）。
 *
 * 只为测试用：不嵌入字体、不做压缩，xref 偏移按字节现算。
 * 每页两行：第一行固定页眉（用来验证页眉被剔除），第二行是该页独有正文。
 */
export function writePdf(target: string, pages: string[][]): void {
  const objects: string[] = []
  const add = (body: string): number => {
    objects.push(body)
    return objects.length
  }

  const catalog = add('<< /Type /Catalog /Pages 2 0 R >>')
  const pagesId = add('')
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')

  const kids: string[] = []
  for (const lines of pages) {
    const content = [
      'BT',
      '/F1 12 Tf',
      '72 720 Td',
      ...lines.flatMap((line, index) => [
        index === 0 ? '' : '0 -18 Td',
        `(${escapePdf(line)}) Tj`
      ]),
      'ET'
    ]
      .filter((line) => line !== '')
      .join('\n')

    const streamId = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`)
    const pageId = add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${streamId} 0 R >>`
    )
    kids.push(`${pageId} 0 R`)
  }

  objects[pagesId - 1] =
    `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })

  const xref = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\n`
  pdf += `startxref\n${xref}\n%%EOF\n`

  writeFileSync(target, Buffer.from(pdf, 'latin1'))
}

function escapePdf(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}
