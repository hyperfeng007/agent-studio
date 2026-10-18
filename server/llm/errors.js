/**
 * 统一的 API 错误类型。单独成文件，避免 net.js ↔ openai.js 循环引用；
 * openai.js 继续 `export { ApiError }`，所有既有 import 路径不变。
 */
export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status || 0
  }
}
