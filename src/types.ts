export enum ERROR_DICT {
  GENERIC_ERROR = '未知错误',
  REQUEST = 'HTTP请求发送失败',
  INVALID_OPTIONS = '参数错误',
  INVALID_FILE = '文件错误',
  INIT_MULTIPART_UPLOAD = '初始化分片上传失败',
  UPLOAD_PART = '分片上传失败',
  COMPLETE_MULTIPART_UPLOAD = '分片合并失败',
  ABORT_MULTIPART_UPLOAD = '终止分片上传失败',
  CANCELLED = '上传已取消',
}

export class UploadError extends Error {
  file?: string
  type: ERROR_DICT
  recordList: string[]
  cause?: unknown

  constructor(option: { file?: string; type?: ERROR_DICT; message?: string; cause?: unknown }) {
    super(option.message || option.type || ERROR_DICT.GENERIC_ERROR)
    this.name = 'UploadError'
    this.file = option.file
    this.type = option.type || ERROR_DICT.GENERIC_ERROR
    this.recordList = [this.file, this.type, this.message].filter(Boolean) as string[]
    this.cause = option.cause
  }

  toString() {
    return `file: (${this.file || 'unknown'})\nError(${this.name}): ${this.message}`
  }
}

export const toUploadError = (file: string, type: ERROR_DICT, cause?: unknown) => {
  if (cause instanceof UploadError) {
    return cause
  }
  const message = cause instanceof Error ? cause.message : String(cause ?? type)
  return new UploadError({ file, type, message, cause })
}
