/**
 * PDF 上传体积守卫（纯函数）。
 *
 * 浏览器 File 无本地绝对路径，几十 MB 的书走 multipart 会把网关撑住
 *（路由注释已写）。达到上限的 File 禁止交给 import/map，引导用户改填
 * 「大文件本地直读」（本机绝对路径直读 JSON）。
 */

/** 上传上限：32 MiB（写死的是字节数常量，不是私人路径）。 */
export const PDF_UPLOAD_SIZE_LIMIT_BYTES = 32 * 1024 * 1024;

/** size（字节）达到上限即太大不能上传。 */
export function isPdfUploadTooLarge(sizeBytes: number): boolean {
  return sizeBytes >= PDF_UPLOAD_SIZE_LIMIT_BYTES;
}

/**
 * 超大文件引导文案（单源，toast 与 PDF 区内联错误共用，禁止另写第二套句子）。
 * 带文件名与约 MB，明确指向「本机绝对路径直读」。Chrome File 无绝对路径，
 * 此处只引导手填，禁止臆造盘符。
 */
export function pdfTooLargeMessage(fileName: string, sizeBytes: number): string {
  const mb = Math.max(1, Math.round(sizeBytes / (1024 * 1024)));
  return `《${fileName}》约 ${mb}MB，不能用选择文件上传。请把该文件的完整绝对路径贴到下方「本机绝对路径直读」，再点开始导入。`;
}

/**
 * 路径剥引号：文件选择器/截图复制常带一对 `"`（或 `'`）；trim 后只剥两端成对引号，
 * 不动路径中间字符。网关 readLocalPdfFile 入口同样剥一次。
 */
export function stripPdfPathQuotes(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}
