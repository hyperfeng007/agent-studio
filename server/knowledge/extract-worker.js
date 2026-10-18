import { parentPort, workerData } from 'node:worker_threads'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
try {
  const buffer = await fs.readFile(workerData.file)
  let pages=[]
  if(workerData.ext === '.pdf') {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdf = await getDocument({data:new Uint8Array(buffer),useSystemFonts:true,isEvalSupported:false,disableFontFace:true}).promise
    try {
      if(pdf.numPages>150) throw Error('PDF 超过 150 页，请拆分后导入（不会静默截断）')
      for(let index=1;index<=pdf.numPages;index++) {
        const page=await pdf.getPage(index)
        const content=await page.getTextContent()
        pages.push({page:index,text:content.items.map(item=>item.str+(item.hasEOL?'\n':' ')).join('')})
      }
    } finally { await pdf.destroy() }
  } else if(workerData.ext === '.docx') {
    const mammoth = require('mammoth')
    const result = await mammoth.extractRawText({buffer})
    pages=[{page:null,text:result.value}]
  } else {
    const text = new TextDecoder('utf-8',{fatal:true}).decode(buffer)
    pages=[{page:null,text}]
  }
  const length=pages.reduce((n,p)=>n+p.text.length,0)
  if(!length || !pages.some(p=>p.text.trim())) throw Error('未提取到文本。扫描版 PDF 请先 OCR，再导入；本版本不含 OCR。')
  if(length>200000) throw Error('文档文本超过 20 万字符，请拆分后导入')
  parentPort.postMessage({pages})
} catch(e) { parentPort.postMessage({error:e.message}) }
