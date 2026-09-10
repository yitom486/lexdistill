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
