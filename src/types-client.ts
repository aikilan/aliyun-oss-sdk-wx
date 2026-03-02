export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD'

export type QueryValue = string | number | boolean | null | undefined
export type Query = Record<string, QueryValue>
export type HeaderValue = string | number | boolean | undefined
export type Headers = Record<string, HeaderValue>

export type OSSFileInput =
  | string
  | ArrayBuffer
  | Uint8Array
  | {
      path: string
      size?: number
      mime?: string
    }

export type RefreshSTSTokenResult = {
  accessKeyId: string
  accessKeySecret: string
  stsToken: string
}

export type OSSClientOptions = {
  region?: string
  bucket: string
  endpoint: string
  cname?: boolean
  secure?: boolean
  accessKeyId: string
  accessKeySecret: string
  stsToken?: string
  refreshSTSToken?: () => Promise<RefreshSTSTokenResult>
  refreshSTSTokenInterval?: number
  retryMax?: number
  timeout?: number
  headers?: Headers
}

export type CommonRequestOptions = {
  headers?: Headers
  timeout?: number
  query?: Query
  subres?: Query
  mime?: string
  meta?: Record<string, string | number | boolean>
  versionId?: string
  process?: string
}

export type CallbackOptions = {
  url: string
  host?: string
  body: string
  contentType?: string
  callbackSNI?: boolean
  customValue?: Record<string, string>
}

export type PutOptions = CommonRequestOptions & {
  callback?: CallbackOptions
  disabledMD5?: boolean
  method?: HTTPMethod
}

export type AppendOptions = PutOptions & {
  position?: string | number
}

export type GetOptions = CommonRequestOptions & {
  responseCacheControl?: string | null
}

export type CopyOptions = CommonRequestOptions

export type DeleteMultiName = string | { key: string; versionId?: string }

export type SignatureUrlOptions = {
  method?: HTTPMethod
  expires?: number
  [key: string]: QueryValue | HTTPMethod
}

export type RequestResult = {
  status: number
  headers: Record<string, string>
  data: any
  res: WechatMiniprogram.RequestSuccessCallbackResult<any>
}

export type PutResult = {
  name: string
  url: string
  etag?: string
  res: WechatMiniprogram.RequestSuccessCallbackResult<any>
  data?: any
}

export type GetResult = {
  res: WechatMiniprogram.RequestSuccessCallbackResult<any>
  content: ArrayBuffer | string
}

export type HeadResult = {
  meta: Record<string, string> | null
  res: WechatMiniprogram.RequestSuccessCallbackResult<any>
  status: number
}

export type DeleteResult = {
  res: WechatMiniprogram.RequestSuccessCallbackResult<any>
}

export type CopyResult = {
  data: {
    etag?: string
    lastModified?: string
  } | null
  res: WechatMiniprogram.RequestSuccessCallbackResult<any>
}

export type ListedObject = {
  name: string
  url: string
  lastModified?: string
  etag?: string
  type?: string
  size?: number
  storageClass?: string
  owner?: {
    id?: string
    displayName?: string
  } | null
}

export type ListResult = {
  res: WechatMiniprogram.RequestSuccessCallbackResult<any>
  objects: ListedObject[]
  prefixes: string[] | null
  nextMarker: string | null
  isTruncated: boolean
}

export type ListV2Result = {
  res: WechatMiniprogram.RequestSuccessCallbackResult<any>
  objects: ListedObject[]
  prefixes: string[] | null
  isTruncated: boolean
  keyCount: number
  continuationToken: string | null
  nextContinuationToken: string | null
}

export type MultipartPart = {
  number: number
  etag: string
}

export type InitMultipartUploadResult = {
  res: WechatMiniprogram.RequestSuccessCallbackResult<any>
  bucket?: string
  name?: string
  uploadId: string
}

export type UploadPartResult = {
  name: string
  etag: string
  res: WechatMiniprogram.RequestSuccessCallbackResult<any>
}

export type CompleteMultipartUploadResult = {
  res: WechatMiniprogram.RequestSuccessCallbackResult<any>
  bucket: string
  name: string
  etag?: string
  location?: string
  data?: any
}

export type ListPartsResult = {
  res: WechatMiniprogram.RequestSuccessCallbackResult<any>
  uploadId?: string
  bucket?: string
  name?: string
  partNumberMarker?: string
  nextPartNumberMarker?: string
  maxParts?: string
  isTruncated?: string
  parts: Array<{ PartNumber?: number; ETag?: string; Size?: number; LastModified?: string }>
}

export type ListUploadsResult = {
  res: WechatMiniprogram.RequestSuccessCallbackResult<any>
  uploads: Array<{ name?: string; uploadId?: string; initiated?: string }>
  bucket?: string
  nextKeyMarker?: string
  nextUploadIdMarker?: string
  isTruncated: boolean
}

export type AbortMultipartUploadResult = {
  res: WechatMiniprogram.RequestSuccessCallbackResult<any>
}

export type MultipartCheckpoint = {
  file: OSSFileInput
  name: string
  fileSize: number
  partSize: number
  uploadId: string
  doneParts: MultipartPart[]
}

export type MultipartUploadOptions = CommonRequestOptions & {
  callback?: CallbackOptions
  disabledMD5?: boolean
  partSize?: number
  parallel?: number
  checkpoint?: MultipartCheckpoint
  progress?: (
    percentage: number,
    checkpoint?: MultipartCheckpoint | null,
    res?: WechatMiniprogram.RequestSuccessCallbackResult<any>,
  ) => Promise<void> | void
}

export type CancelAbortOptions = {
  name: string
  uploadId: string
  options?: CommonRequestOptions
}

export type CancelEvent = {
  status: 0
  name: 'cancel'
}

export type AbortEvent = {
  status: 0
  name: 'abort'
  message: 'upload task has been abort'
}
