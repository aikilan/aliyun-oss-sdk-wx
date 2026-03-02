import { XMLParser } from 'fast-xml-parser'
import { canonicalString, computeSignature } from './utils/aliyun-utils.js'
import {
  AbortEvent,
  CancelAbortOptions,
  CancelEvent,
  HeaderValue,
  Headers,
  HTTPMethod,
  OSSClientOptions,
  OSSFileInput,
  Query,
  RequestResult,
  SignatureUrlOptions,
} from './types-client'
import { ERROR_DICT, toUploadError } from './types'

type InternalRequestOptions = {
  method: HTTPMethod
  objectName?: string
  query?: Query
  headers?: Headers
  data?: string | ArrayBuffer | Uint8Array
  timeout?: number
  mime?: string
  successStatuses?: number[]
  responseType?: 'text' | 'arraybuffer'
  xmlResponse?: boolean
}

const SIGN_QUERY_KEY_ALLOW_LIST = new Set([
  'acl',
  'append',
  'bucketInfo',
  'comp',
  'cors',
  'delete',
  'encoding-type',
  'lifecycle',
  'link',
  'location',
  'logging',
  'max-keys',
  'max-parts',
  'max-uploads',
  'objectMeta',
  'partNumber',
  'part-number-marker',
  'position',
  'prefix',
  'restore',
  'security-token',
  'symlink',
  'tagging',
  'uploadId',
  'upload-id-marker',
  'uploads',
  'versionId',
  'versioning',
  'website',
  'x-oss-process',
  'list-type',
  'continuation-token',
  'start-after',
  'delimiter',
  'response-content-type',
  'response-content-language',
  'response-expires',
  'response-cache-control',
  'response-content-disposition',
  'response-content-encoding',
])

const toHeaderString = (value: HeaderValue) => {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  return String(value)
}

const normalizeHeaders = (header: Record<string, any> | undefined): Record<string, string> => {
  const result: Record<string, string> = {}
  if (!header) {
    return result
  }
  Object.keys(header).forEach(key => {
    const value = header[key]
    if (value === undefined || value === null) {
      return
    }
    result[key.toLowerCase()] = String(value)
  })
  return result
}

const stringToUtf8ArrayBuffer = (value: string): ArrayBuffer => {
  const bytes: number[] = []
  for (let i = 0; i < value.length; i += 1) {
    let codePoint = value.codePointAt(i) as number
    if (codePoint > 0xffff) {
      i += 1
    }

    if (codePoint <= 0x7f) {
      bytes.push(codePoint)
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f))
    } else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f))
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      )
    }
  }
  return new Uint8Array(bytes).buffer
}

const utf8BytesToString = (data: ArrayBuffer | Uint8Array): string => {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  let output = ''

  for (let i = 0; i < bytes.length; ) {
    const byte1 = bytes[i++]

    if ((byte1 & 0x80) === 0) {
      output += String.fromCodePoint(byte1)
      continue
    }

    if ((byte1 & 0xe0) === 0xc0) {
      const byte2 = bytes[i++] ?? 0
      const codePoint = ((byte1 & 0x1f) << 6) | (byte2 & 0x3f)
      output += String.fromCodePoint(codePoint)
      continue
    }

    if ((byte1 & 0xf0) === 0xe0) {
      const byte2 = bytes[i++] ?? 0
      const byte3 = bytes[i++] ?? 0
      const codePoint = ((byte1 & 0x0f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f)
      output += String.fromCodePoint(codePoint)
      continue
    }

    const byte2 = bytes[i++] ?? 0
    const byte3 = bytes[i++] ?? 0
    const byte4 = bytes[i++] ?? 0
    const codePoint = ((byte1 & 0x07) << 18) | ((byte2 & 0x3f) << 12) | ((byte3 & 0x3f) << 6) | (byte4 & 0x3f)
    output += String.fromCodePoint(codePoint)
  }

  return output
}

const toArrayBuffer = (value: string | ArrayBuffer | Uint8Array): ArrayBuffer => {
  if (value instanceof ArrayBuffer) {
    return value
  }
  if (value instanceof Uint8Array) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
  }
  return stringToUtf8ArrayBuffer(value)
}

const parseEndpoint = (endpoint: string, secure?: boolean) => {
  const raw = String(endpoint || '').trim()
  let protocol: 'http' | 'https' = secure === false ? 'http' : 'https'
  let host = raw

  if (/^https?:\/\//i.test(raw)) {
    protocol = /^http:\/\//i.test(raw) ? 'http' : 'https'
    host = raw.replace(/^https?:\/\//i, '')
  }

  const firstSlash = host.indexOf('/')
  if (firstSlash >= 0) {
    host = host.slice(0, firstSlash)
  }

  host = host.replace(/\/+$/g, '')

  if (!host) {
    throw toUploadError('request-core.ts', ERROR_DICT.INVALID_OPTIONS, new Error('endpoint is required'))
  }

  return {
    host,
    protocol,
  }
}

export default class RequestCore {
  protected readonly parser = new XMLParser({
    ignoreAttributes: false,
    trimValues: true,
    parseTagValue: true,
  })

  protected options: OSSClientOptions
  private lastSTSRefreshAt = 0
  private cancelFlag = false
  private readonly activeTasks = new Set<WechatMiniprogram.RequestTask>()

  constructor(options: OSSClientOptions) {
    this.options = {
      secure: true,
      retryMax: 0,
      refreshSTSTokenInterval: 300,
      timeout: 60000,
      headers: {},
      ...options,
    }
    this.assertClientOptions()
  }

  public get currentOptions() {
    return { ...this.options }
  }

  public useBucket(name: string) {
    this.options.bucket = name
  }

  public isCancel() {
    return this.cancelFlag
  }

  public resetCancelFlag() {
    this.cancelFlag = false
  }

  public cancel(abort?: CancelAbortOptions) {
    this.cancelFlag = true
    this.activeTasks.forEach(task => {
      try {
        task.abort()
      } catch (error) {
        // ignore abort error
      }
    })
    this.activeTasks.clear()

    const abortMultipartUpload = (this as any).abortMultipartUpload
    if (abort && typeof abortMultipartUpload === 'function') {
      void abortMultipartUpload.call(this, abort.name, abort.uploadId, abort.options).catch(() => {
        // abort hook should not block cancel
      })
    }
  }

  public signatureUrl(name: string, options: SignatureUrlOptions = {}, strictObjectNameValidation = true) {
    this.ensureBucket()
    if (strictObjectNameValidation && /^\?/.test(name)) {
      throw toUploadError('request-core.ts', ERROR_DICT.INVALID_OPTIONS, new Error(`Invalid object name ${name}`))
    }

    const objectName = this.objectName(name)
    const method = (options.method || 'GET') as HTTPMethod
    const expires = Math.floor(Date.now() / 1000) + Number(options.expires || 1800)
    const query: Query = {}
    Object.keys(options).forEach(key => {
      if (key === 'method' || key === 'expires') {
        return
      }
      query[key] = options[key] as any
    })
    if (this.options.stsToken) {
      query['security-token'] = this.options.stsToken
    }

    const canonicalQuery = this.toSignQuery(query)
    const signature = computeSignature(
      this.options.accessKeySecret,
      canonicalString(method, this.resourcePath(objectName), { 'content-type': '' }, canonicalQuery, String(expires)),
    )

    const signedQuery: Query = {
      ...query,
      OSSAccessKeyId: this.options.accessKeyId,
      Expires: expires,
      Signature: signature,
    }

    return this.buildRequestUrl(objectName, signedQuery)
  }

  public async asyncSignatureUrl(name: string, options: SignatureUrlOptions = {}, strictObjectNameValidation = true) {
    if (this.options.stsToken && this.options.refreshSTSToken) {
      await this.maybeRefreshSTSToken(true)
    }
    return this.signatureUrl(name, options, strictObjectNameValidation)
  }

  protected parseXML(data: unknown) {
    const text = this.decodeText(data)
    if (!text || !text.trim()) {
      return {}
    }
    return this.parser.parse(text)
  }

  protected safeJsonParse(input: string) {
    try {
      return JSON.parse(input)
    } catch (error) {
      return input
    }
  }

  protected ensureBucket() {
    if (!this.options.bucket) {
      throw toUploadError('request-core.ts', ERROR_DICT.INVALID_OPTIONS, new Error('Please create a bucket first'))
    }
  }

  protected objectName(name: string) {
    return String(name || '').replace(/^\/+/, '')
  }

  protected escapeObjectName(name: string) {
    return this.objectName(name)
      .split('/')
      .map(part => encodeURIComponent(part))
      .join('/')
  }

  protected objectUrl(name: string) {
    return this.buildRequestUrl(this.objectName(name))
  }

  protected async request(options: InternalRequestOptions): Promise<RequestResult> {
    if (this.cancelFlag) {
      throw this.makeCancelEvent()
    }

    await this.maybeRefreshSTSToken()

    const method = options.method
    const objectName = this.objectName(options.objectName || '')
    const query = this.normalizeQuery(options.query)

    const headers: Record<string, string> = {
      ...this.normalizeHeaderMap(this.options.headers || {}),
      ...this.normalizeHeaderMap(options.headers || {}),
    }

    if (options.mime) {
      headers['content-type'] = options.mime
    }
    if (this.options.stsToken) {
      headers['x-oss-security-token'] = this.options.stsToken
    }

    const date = new Date().toUTCString()
    headers['x-oss-date'] = date

    const canonicalQuery = this.toSignQuery(query)
    const signature = computeSignature(
      this.options.accessKeySecret,
      canonicalString(method, this.resourcePath(objectName), headers, canonicalQuery, date),
    )
    headers.authorization = `OSS ${this.options.accessKeyId}:${signature}`

    const requestUrl = this.buildRequestUrl(objectName, query)
    const successStatuses = options.successStatuses || [200]
    const retryMax = Math.max(0, Number(this.options.retryMax || 0))

    let attempt = 0
    while (attempt <= retryMax) {
      try {
        const res = await this.wxRequest({
          method,
          url: requestUrl,
          header: headers,
          data: options.data ? toArrayBuffer(options.data) : undefined,
          timeout: options.timeout || this.options.timeout,
          responseType: options.responseType || 'text',
        })

        if (!successStatuses.includes(res.status)) {
          const statusError = new Error(`Request failed with status ${res.status}`)
          ;(statusError as any).status = res.status
          ;(statusError as any).res = res.res
          ;(statusError as any).data = res.data
          throw statusError
        }

        return {
          status: res.status,
          headers: res.headers,
          data: options.xmlResponse ? this.parseXML(res.data) : res.data,
          res: res.res,
        }
      } catch (error: any) {
        if (error?.errMsg?.includes?.('abort') || error?.name === 'cancel') {
          throw this.makeCancelEvent()
        }
        if (attempt >= retryMax) {
          throw toUploadError('request-core.ts', ERROR_DICT.REQUEST, error)
        }
        attempt += 1
      }
    }

    throw toUploadError('request-core.ts', ERROR_DICT.REQUEST, new Error('Request retry exceeded'))
  }

  protected async getFileSize(file: OSSFileInput): Promise<number> {
    if (file instanceof ArrayBuffer) {
      return file.byteLength
    }
    if (file instanceof Uint8Array) {
      return file.byteLength
    }
    if (typeof file === 'object' && file && 'size' in file && typeof file.size === 'number') {
      return file.size
    }

    const path = this.resolveFilePath(file)
    const fs = this.getFileSystemManager()

    if (typeof fs.getFileInfo === 'function') {
      return await new Promise<number>((resolve, reject) => {
        fs.getFileInfo({
          filePath: path,
          success: res => resolve(res.size),
          fail: reject,
        })
      })
    }

    const content = fs.readFileSync(path) as ArrayBuffer | string
    return toArrayBuffer(content).byteLength
  }

  protected async createBuffer(file: OSSFileInput, start = 0, end?: number): Promise<ArrayBuffer> {
    if (file instanceof ArrayBuffer) {
      const endOffset = end ?? file.byteLength
      return file.slice(start, endOffset)
    }

    if (file instanceof Uint8Array) {
      const endOffset = end ?? file.byteLength
      return file.buffer.slice(file.byteOffset + start, file.byteOffset + endOffset) as ArrayBuffer
    }

    const path = this.resolveFilePath(file)
    const fs = this.getFileSystemManager()
    const length = end === undefined ? undefined : Math.max(end - start, 0)
    const data = fs.readFileSync(path, undefined, start, length) as string | ArrayBuffer
    return toArrayBuffer(data)
  }

  protected writeFile(path: string, data: ArrayBuffer | string) {
    const fs = this.getFileSystemManager()
    fs.writeFileSync(path, data)
  }

  protected encodeCallback(callback: {
    url: string
    host?: string
    body: string
    contentType?: string
    callbackSNI?: boolean
    customValue?: Record<string, string>
  }) {
    const encodedCallback = this.base64Encode(
      JSON.stringify({
        callbackUrl: callback.url,
        callbackHost: callback.host,
        callbackBody: callback.body,
        callbackBodyType: callback.contentType,
        callbackSNI: callback.callbackSNI,
      }),
    )

    const callbackVar: Record<string, string> = {}
    Object.keys(callback.customValue || {}).forEach(key => {
      callbackVar[`x:${key}`] = String(callback.customValue?.[key] ?? '')
    })

    return {
      'x-oss-callback': encodedCallback,
      ...(Object.keys(callbackVar).length ? { 'x-oss-callback-var': this.base64Encode(JSON.stringify(callbackVar)) } : {}),
    }
  }

  protected applyMetaToHeaders(
    meta: Record<string, string | number | boolean> | undefined,
    headers: Headers = {},
  ): Record<string, string> {
    const nextHeaders = this.normalizeHeaderMap(headers)
    Object.keys(meta || {}).forEach(key => {
      nextHeaders[`x-oss-meta-${key}`] = String(meta?.[key] ?? '')
    })
    return nextHeaders
  }

  protected decodeText(data: unknown) {
    if (typeof data === 'string') {
      return data
    }
    if (data instanceof ArrayBuffer) {
      return utf8BytesToString(data)
    }
    if (data instanceof Uint8Array) {
      return utf8BytesToString(data)
    }
    return String(data || '')
  }

  protected toArray<T>(value: T | T[] | undefined | null): T[] {
    if (!value) {
      return []
    }
    return Array.isArray(value) ? value : [value]
  }

  protected makeAbortEvent(): AbortEvent {
    return {
      status: 0,
      name: 'abort',
      message: 'upload task has been abort',
    }
  }

  protected makeCancelEvent(): CancelEvent {
    return {
      status: 0,
      name: 'cancel',
    }
  }

  protected stop() {
    this.cancelFlag = true
  }

  private assertClientOptions() {
    if (!this.options.endpoint) {
      throw toUploadError('request-core.ts', ERROR_DICT.INVALID_OPTIONS, new Error('endpoint is required'))
    }
    if (!this.options.accessKeyId || !this.options.accessKeySecret) {
      throw toUploadError(
        'request-core.ts',
        ERROR_DICT.INVALID_OPTIONS,
        new Error('accessKeyId and accessKeySecret are required'),
      )
    }
    this.ensureBucket()
  }

  private async maybeRefreshSTSToken(force = false) {
    const refreshSTSToken = this.options.refreshSTSToken
    if (!refreshSTSToken) {
      return
    }

    const now = Date.now()
    const intervalMs = Number(this.options.refreshSTSTokenInterval || 300) * 1000
    if (!force && now - this.lastSTSRefreshAt < intervalMs) {
      return
    }

    const refreshed = await refreshSTSToken()
    if (refreshed?.accessKeyId) {
      this.options.accessKeyId = refreshed.accessKeyId
    }
    if (refreshed?.accessKeySecret) {
      this.options.accessKeySecret = refreshed.accessKeySecret
    }
    if (refreshed?.stsToken) {
      this.options.stsToken = refreshed.stsToken
    }
    this.lastSTSRefreshAt = now
  }

  private resolveFilePath(file: OSSFileInput) {
    if (typeof file === 'string') {
      return file
    }

    if (typeof file === 'object' && file && !(file instanceof ArrayBuffer) && !(file instanceof Uint8Array) && 'path' in file) {
      return file.path
    }

    throw toUploadError('request-core.ts', ERROR_DICT.INVALID_FILE, new Error('Must provide local file path or binary file data'))
  }

  private getFileSystemManager() {
    return wx.getFileSystemManager()
  }

  private base64Encode(text: string) {
    if (typeof wx.arrayBufferToBase64 === 'function') {
      return wx.arrayBufferToBase64(stringToUtf8ArrayBuffer(text))
    }

    throw toUploadError('request-core.ts', ERROR_DICT.INVALID_OPTIONS, new Error('No base64 encoder found'))
  }

  private normalizeHeaderMap(headers: Headers) {
    const nextHeaders: Record<string, string> = {}
    Object.keys(headers || {}).forEach(key => {
      const headerValue = toHeaderString(headers[key])
      if (headerValue !== undefined) {
        nextHeaders[key] = headerValue
      }
    })
    return nextHeaders
  }

  private normalizeQuery(query?: Query) {
    const result: Query = {}
    Object.keys(query || {}).forEach(key => {
      const value = query?.[key]
      if (value !== undefined && value !== null) {
        result[key] = value
      }
    })
    return result
  }

  private toSignQuery(query: Query) {
    const signed: Query = {}
    Object.keys(query)
      .sort()
      .forEach(key => {
        if (SIGN_QUERY_KEY_ALLOW_LIST.has(key) || key.startsWith('response-')) {
          signed[key] = query[key]
        }
      })
    return signed
  }

  private buildRequestUrl(objectName: string, query: Query = {}) {
    const endpoint = parseEndpoint(this.options.endpoint, this.options.secure)
    const escapedObjectName = this.escapeObjectName(objectName)

    let url = ''
    if (this.options.cname) {
      url = `${endpoint.protocol}://${endpoint.host}/${escapedObjectName}`
    } else {
      url = `${endpoint.protocol}://${this.options.bucket}.${endpoint.host}/${escapedObjectName}`
    }

    const queryString = Object.keys(query)
      .sort()
      .map(key => {
        const value = query[key]
        if (value === undefined || value === null) {
          return ''
        }
        if (value === '') {
          return encodeURIComponent(key)
        }
        return `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
      })
      .filter(Boolean)
      .join('&')

    return queryString ? `${url}?${queryString}` : url
  }

  private resourcePath(objectName: string) {
    const escapedObjectName = this.escapeObjectName(objectName)
    if (!escapedObjectName) {
      return `/${this.options.bucket}/`
    }
    return `/${this.options.bucket}/${escapedObjectName}`
  }

  private async wxRequest(params: {
    method: HTTPMethod
    url: string
    header: Record<string, string>
    data?: ArrayBuffer
    timeout?: number
    responseType?: 'text' | 'arraybuffer'
  }) {
    return await new Promise<{
      status: number
      headers: Record<string, string>
      data: any
      res: WechatMiniprogram.RequestSuccessCallbackResult<any>
    }>((resolve, reject) => {
      let task: WechatMiniprogram.RequestTask | undefined
      task = wx.request({
        method: params.method,
        url: params.url,
        header: params.header,
        data: params.data,
        timeout: params.timeout,
        responseType: params.responseType,
        success: res => {
          if (task) {
            this.activeTasks.delete(task)
          }
          resolve({
            status: res.statusCode,
            headers: normalizeHeaders(res.header as Record<string, any>),
            data: res.data,
            res,
          })
        },
        fail: err => {
          if (task) {
            this.activeTasks.delete(task)
          }
          reject(err)
        },
      })

      if (task) {
        this.activeTasks.add(task)
      }
    })
  }
}
