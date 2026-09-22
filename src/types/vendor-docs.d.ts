declare module 'pdf-parse/lib/pdf-parse.js' {
  type PdfParse = (dataBuffer: Buffer) => Promise<{
    numpages: number
    numrender: number
    info: Record<string, unknown>
    metadata: unknown
    text: string
    version: string
  }>
  const pdfParse: PdfParse
  export default pdfParse
}

declare module 'jszip' {
  interface JSZipObject {
    dir: boolean
    async(type: 'text' | 'nodebuffer' | 'uint8array' | 'string'): Promise<string | Buffer | Uint8Array>
  }
  interface JSZip {
    files: Record<string, JSZipObject & { dir: boolean }>
    file(name: string): JSZipObject | null
  }
  interface JSZipStatic {
    loadAsync(data: Buffer | Uint8Array | ArrayBuffer | string): Promise<JSZip>
    new (): JSZip
  }
  const JSZip: JSZipStatic
  export default JSZip
}
