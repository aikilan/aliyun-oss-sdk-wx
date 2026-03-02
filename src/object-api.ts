import RequestCore from './request-core'
import {
  AppendOptions,
  CopyOptions,
  CopyResult,
  DeleteMultiName,
  DeleteResult,
  GetOptions,
  GetResult,
  HeadResult,
  ListResult,
  ListV2Result,
  PutOptions,
  PutResult,
} from './types-client'
import { ERROR_DICT, toUploadError } from './types'

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  txt: 'text/plain',
  json: 'application/json',
  xml: 'application/xml',
  pdf: 'application/pdf',
  zip: 'application/zip',
}

const getMimeTypeByPath = (path: string) => {
  if (!path) {
    return undefined
  }
  const normalized = path.split('?')[0].split('#')[0]
  const dotIndex = normalized.lastIndexOf('.')
  if (dotIndex < 0 || dotIndex === normalized.length - 1) {
    return undefined
  }
  const ext = normalized.slice(dotIndex + 1).toLowerCase()
  return MIME_MAP[ext]
}

export default class ObjectAPI extends RequestCore {
  public async put(name: string, file: any, options: PutOptions = {}): Promise<PutResult> {
    const objectName = this.objectName(name)
    const content = await this.createBuffer(file)
    const mimeType = options.mime || this.detectMimeType(file, objectName)

    let headers = this.applyMetaToHeaders(options.meta, options.headers)
    if (options.callback) {
      headers = {
        ...headers,
        ...this.encodeCallback(options.callback),
      }
    }

    const result = await this.request({
      method: options.method || 'PUT',
      objectName,
      query: options.subres || options.query,
      headers,
      data: content,
      timeout: options.timeout,
      mime: mimeType,
      successStatuses: [200],
    })

    const ret: PutResult = {
      name: objectName,
      url: this.objectUrl(objectName),
      etag: result.headers.etag,
      res: result.res,
    }

    if (headers['x-oss-callback']) {
      const callbackData = this.decodeText(result.data)
      ret.data = this.safeJsonParse(callbackData)
    }

    return ret
  }

  public async append(name: string, file: any, options: AppendOptions = {}): Promise<PutResult & { nextAppendPosition?: string }> {
    const position = options.position === undefined ? '0' : String(options.position)
    const result = await this.put(name, file, {
      ...options,
      method: 'POST',
      subres: {
        ...(options.subres || {}),
        append: '',
        position,
      },
    })

    return {
      ...result,
      nextAppendPosition: (result.res.header as Record<string, any>)?.['x-oss-next-append-position'],
    }
  }

  public async get(name: string, fileOrOptions?: string | GetOptions, options: GetOptions = {}): Promise<GetResult> {
    const objectName = this.objectName(name)
    const isPath = typeof fileOrOptions === 'string'
    const requestOptions = (isPath ? options : (fileOrOptions as GetOptions)) || {}

    const subres = {
      ...(requestOptions.subres || {}),
      ...(requestOptions.versionId ? { versionId: requestOptions.versionId } : {}),
      ...(requestOptions.process ? { 'x-oss-process': requestOptions.process } : {}),
      ...(requestOptions.responseCacheControl === null
        ? { 'response-cache-control': '' }
        : requestOptions.responseCacheControl
          ? { 'response-cache-control': requestOptions.responseCacheControl }
          : {}),
    }

    const result = await this.request({
      method: 'GET',
      objectName,
      query: {
        ...(requestOptions.query || {}),
        ...subres,
      },
      headers: requestOptions.headers,
      timeout: requestOptions.timeout,
      responseType: 'arraybuffer',
      successStatuses: [200, 206, 304],
    })

    if (isPath && fileOrOptions) {
      this.writeFile(fileOrOptions, result.data as ArrayBuffer)
    }

    return {
      res: result.res,
      content: result.data as ArrayBuffer,
    }
  }

  public async head(name: string, options: GetOptions = {}): Promise<HeadResult> {
    const objectName = this.objectName(name)
    const query = {
      ...(options.query || {}),
      ...(options.subres || {}),
      ...(options.versionId ? { versionId: options.versionId } : {}),
    }

    const result = await this.request({
      method: 'HEAD',
      objectName,
      query,
      headers: options.headers,
      timeout: options.timeout,
      successStatuses: [200, 304],
    })

    const meta: Record<string, string> = {}
    Object.keys(result.headers).forEach(key => {
      if (key.startsWith('x-oss-meta-')) {
        meta[key.slice(11)] = result.headers[key]
      }
    })

    return {
      meta: Object.keys(meta).length ? meta : null,
      res: result.res,
      status: result.status,
    }
  }

  public async delete(name: string, options: GetOptions = {}): Promise<DeleteResult> {
    const objectName = this.objectName(name)
    const result = await this.request({
      method: 'DELETE',
      objectName,
      query: {
        ...(options.query || {}),
        ...(options.subres || {}),
        ...(options.versionId ? { versionId: options.versionId } : {}),
      },
      headers: options.headers,
      timeout: options.timeout,
      successStatuses: [204],
    })

    return {
      res: result.res,
    }
  }

  public async copy(
    name: string,
    sourceName: string,
    sourceBucketOrOptions?: string | CopyOptions,
    maybeOptions?: CopyOptions,
  ): Promise<CopyResult> {
    const objectName = this.objectName(name)

    const options: CopyOptions =
      typeof sourceBucketOrOptions === 'object' && sourceBucketOrOptions
        ? sourceBucketOrOptions
        : (maybeOptions || {})

    const sourceBucket = typeof sourceBucketOrOptions === 'string' ? sourceBucketOrOptions : this.currentOptions.bucket
    const sourcePath = this.buildCopySource(sourceBucket, sourceName)

    const headers = this.applyMetaToHeaders(options.meta, {
      ...(options.headers || {}),
      'x-oss-copy-source': sourcePath,
    })

    const replaceHeaders = [
      'content-type',
      'content-encoding',
      'content-language',
      'content-disposition',
      'cache-control',
      'expires',
    ]

    if (
      options.meta ||
      Object.keys(headers).some(item => replaceHeaders.includes(item.toLowerCase()))
    ) {
      headers['x-oss-metadata-directive'] = 'REPLACE'
    }

    const result = await this.request({
      method: 'PUT',
      objectName,
      query: {
        ...(options.query || {}),
        ...(options.subres || {}),
        ...(options.versionId ? { versionId: options.versionId } : {}),
      },
      headers,
      timeout: options.timeout,
      successStatuses: [200, 304],
      xmlResponse: true,
    })

    const payload = result.data?.CopyObjectResult || result.data || {}

    return {
      data: payload
        ? {
            etag: payload.ETag,
            lastModified: payload.LastModified,
          }
        : null,
      res: result.res,
    }
  }

  public async deleteMulti(names: DeleteMultiName[], options: GetOptions = {}): Promise<{ res: any; deleted: any[] }> {
    if (!names?.length) {
      throw toUploadError('object-api.ts', ERROR_DICT.INVALID_OPTIONS, new Error('names is required'))
    }

    const objectNodes = names
      .map(item => {
        if (typeof item === 'string') {
          return `<Object><Key>${escapeXml(this.objectName(item))}</Key></Object>`
        }

        if (item.versionId) {
          return `<Object><Key>${escapeXml(this.objectName(item.key))}</Key><VersionId>${escapeXml(item.versionId)}</VersionId></Object>`
        }

        return `<Object><Key>${escapeXml(this.objectName(item.key))}</Key></Object>`
      })
      .join('')

    const xml = `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>${options.query?.quiet ? 'true' : 'false'}</Quiet>${objectNodes}</Delete>`

    const result = await this.request({
      method: 'POST',
      objectName: '',
      query: {
        ...(options.query || {}),
        ...(options.subres || {}),
        delete: '',
      },
      headers: options.headers,
      timeout: options.timeout,
      data: xml,
      mime: 'application/xml',
      successStatuses: [200],
      xmlResponse: true,
    })

    const payload = result.data?.DeleteResult || result.data || {}

    return {
      res: result.res,
      deleted: this.toArray(payload.Deleted),
    }
  }

  public async list(query: Record<string, any> = {}, options: GetOptions = {}): Promise<ListResult> {
    const result = await this.request({
      method: 'GET',
      objectName: '',
      query: {
        ...(query || {}),
        ...(options.query || {}),
      },
      headers: options.headers,
      timeout: options.timeout,
      successStatuses: [200],
      xmlResponse: true,
    })

    const payload = result.data?.ListBucketResult || result.data || {}

    const objects = this.toArray(payload.Contents).map((item: any) => {
      const owner = item.Owner
        ? {
            id: item.Owner.ID,
            displayName: item.Owner.DisplayName,
          }
        : null

      return {
        name: item.Key,
        url: this.objectUrl(item.Key),
        lastModified: item.LastModified,
        etag: item.ETag,
        type: item.Type,
        size: Number(item.Size),
        storageClass: item.StorageClass,
        owner,
      }
    })

    const prefixes = this.toArray(payload.CommonPrefixes)
      .map((item: any) => item?.Prefix)
      .filter(Boolean)

    return {
      res: result.res,
      objects,
      prefixes: prefixes.length ? prefixes : null,
      nextMarker: payload.NextMarker || null,
      isTruncated: String(payload.IsTruncated) === 'true',
    }
  }

  public async listV2(query: Record<string, any> = {}, options: GetOptions = {}): Promise<ListV2Result> {
    const continuationToken = query['continuation-token'] || query.continuationToken

    const requestQuery: Record<string, any> = {
      'list-type': 2,
      ...query,
      ...(options.query || {}),
    }

    delete requestQuery['continuation-token']
    delete requestQuery.continuationToken

    const result = await this.request({
      method: 'GET',
      objectName: '',
      query: {
        ...requestQuery,
        ...(continuationToken ? { 'continuation-token': continuationToken } : {}),
      },
      headers: options.headers,
      timeout: options.timeout,
      successStatuses: [200],
      xmlResponse: true,
    })

    const payload = result.data?.ListBucketResult || result.data || {}

    const objects = this.toArray(payload.Contents).map((item: any) => {
      const owner = item.Owner
        ? {
            id: item.Owner.ID,
            displayName: item.Owner.DisplayName,
          }
        : null

      return {
        name: item.Key,
        url: this.objectUrl(item.Key),
        lastModified: item.LastModified,
        etag: item.ETag,
        type: item.Type,
        size: Number(item.Size),
        storageClass: item.StorageClass,
        owner,
      }
    })

    const prefixes = this.toArray(payload.CommonPrefixes)
      .map((item: any) => item?.Prefix)
      .filter(Boolean)

    return {
      res: result.res,
      objects,
      prefixes: prefixes.length ? prefixes : null,
      isTruncated: String(payload.IsTruncated) === 'true',
      keyCount: Number(payload.KeyCount || 0),
      continuationToken: payload.ContinuationToken || null,
      nextContinuationToken: payload.NextContinuationToken || null,
    }
  }

  public getObjectUrl(name: string) {
    return this.objectUrl(this.objectName(name))
  }

  public generateObjectUrl(name: string) {
    return this.getObjectUrl(name)
  }

  private detectMimeType(file: any, objectName: string) {
    if (typeof file === 'object' && file && !(file instanceof ArrayBuffer) && !(file instanceof Uint8Array) && 'mime' in file) {
      return file.mime || getMimeTypeByPath(objectName)
    }
    if (typeof file === 'string') {
      return getMimeTypeByPath(file) || getMimeTypeByPath(objectName)
    }
    return getMimeTypeByPath(objectName)
  }

  private buildCopySource(bucket: string, sourceName: string) {
    const resolvedBucket = String(bucket || '').trim()
    if (!resolvedBucket) {
      throw toUploadError('object-api.ts', ERROR_DICT.INVALID_OPTIONS, new Error('source bucket is required'))
    }

    const objectPath = sourceName.startsWith('/') ? sourceName.slice(1) : sourceName
    const escaped = objectPath
      .split('/')
      .map(part => encodeURIComponent(part))
      .join('/')

    return `/${resolvedBucket}/${escaped}`
  }
}
