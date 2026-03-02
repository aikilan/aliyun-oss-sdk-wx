import ObjectAPI from './object-api'
import {
  AbortMultipartUploadResult,
  CommonRequestOptions,
  CompleteMultipartUploadResult,
  InitMultipartUploadResult,
  ListPartsResult,
  ListUploadsResult,
  MultipartCheckpoint,
  MultipartPart,
  MultipartUploadOptions,
  OSSFileInput,
  UploadPartResult,
} from './types-client'
import { ERROR_DICT, toUploadError } from './types'

export default class MultipartAPI extends ObjectAPI {
  public async initMultipartUpload(name: string, options: CommonRequestOptions = {}): Promise<InitMultipartUploadResult> {
    const objectName = this.objectName(name)

    const headers = this.applyMetaToHeaders(options.meta, options.headers)

    const result = await this.request({
      method: 'POST',
      objectName,
      query: {
        ...(options.query || {}),
        ...(options.subres || {}),
        uploads: '',
      },
      headers,
      timeout: options.timeout,
      mime: options.mime,
      successStatuses: [200],
      xmlResponse: true,
    })

    const payload = result.data?.InitiateMultipartUploadResult || result.data || {}
    const uploadId = payload.UploadId

    if (!uploadId) {
      throw toUploadError('multipart-api.ts', ERROR_DICT.INIT_MULTIPART_UPLOAD, new Error('UploadId missing'))
    }

    return {
      res: result.res,
      bucket: payload.Bucket,
      name: payload.Key,
      uploadId,
    }
  }

  public async uploadPart(
    name: string,
    uploadId: string,
    partNo: number,
    file: OSSFileInput,
    start: number,
    end: number,
    options: CommonRequestOptions = {},
  ): Promise<UploadPartResult> {
    const objectName = this.objectName(name)
    const content = await this.createBuffer(file, start, end)

    const headers = {
      ...(options.headers || {}),
      'content-length': end - start,
    }

    const result = await this.request({
      method: 'PUT',
      objectName,
      query: {
        ...(options.query || {}),
        ...(options.subres || {}),
        uploadId,
        partNumber: partNo,
      },
      headers,
      timeout: options.timeout,
      data: content,
      mime: options.mime,
      successStatuses: [200],
    })

    const etag = result.headers.etag
    if (!etag) {
      throw toUploadError('multipart-api.ts', ERROR_DICT.UPLOAD_PART, new Error('ETag missing in uploadPart response'))
    }

    return {
      name: objectName,
      etag,
      res: result.res,
    }
  }

  public async completeMultipartUpload(
    name: string,
    uploadId: string,
    parts: MultipartPart[],
    options: MultipartUploadOptions = {},
  ): Promise<CompleteMultipartUploadResult> {
    const objectName = this.objectName(name)

    const sortedParts = [...parts]
      .sort((a, b) => a.number - b.number)
      .filter((item, index, arr) => !index || item.number !== arr[index - 1].number)

    const partsXml = sortedParts
      .map(item => `<Part><PartNumber>${item.number}</PartNumber><ETag>${item.etag}</ETag></Part>`)
      .join('')

    const xml = `<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUpload>${partsXml}</CompleteMultipartUpload>`

    let headers = { ...(options.headers || {}) }
    if (options.callback) {
      headers = {
        ...headers,
        ...this.encodeCallback(options.callback),
      }
    }

    const result = await this.request({
      method: 'POST',
      objectName,
      query: {
        ...(options.query || {}),
        ...(options.subres || {}),
        uploadId,
      },
      headers,
      timeout: options.timeout,
      data: xml,
      mime: 'application/xml',
      successStatuses: [200],
      xmlResponse: !headers['x-oss-callback'],
    })

    let payload: any = {}
    if (!headers['x-oss-callback']) {
      payload = result.data?.CompleteMultipartUploadResult || result.data || {}
    }

    const ret: CompleteMultipartUploadResult = {
      res: result.res,
      bucket: payload.Bucket || this.currentOptions.bucket,
      name: payload.Key || objectName,
      etag: payload.ETag || result.headers.etag,
      location: payload.Location,
    }

    if (headers['x-oss-callback']) {
      ret.data = this.safeJsonParse(this.decodeText(result.data))
    }

    if (options.progress) {
      await options.progress(1, null, result.res)
    }

    return ret
  }

  public async listParts(
    name: string,
    uploadId: string,
    query: Record<string, any> = {},
    options: CommonRequestOptions = {},
  ): Promise<ListPartsResult> {
    const objectName = this.objectName(name)

    const result = await this.request({
      method: 'GET',
      objectName,
      query: {
        ...(query || {}),
        ...(options.query || {}),
        ...(options.subres || {}),
        uploadId,
      },
      headers: options.headers,
      timeout: options.timeout,
      successStatuses: [200],
      xmlResponse: true,
    })

    const payload = result.data?.ListPartsResult || result.data || {}

    return {
      res: result.res,
      uploadId: payload.UploadId,
      bucket: payload.Bucket,
      name: payload.Key,
      partNumberMarker: payload.PartNumberMarker,
      nextPartNumberMarker: payload.NextPartNumberMarker,
      maxParts: payload.MaxParts,
      isTruncated: payload.IsTruncated,
      parts: this.toArray(payload.Part).map((item: any) => ({
        PartNumber: Number(item.PartNumber),
        ETag: item.ETag,
        Size: Number(item.Size),
        LastModified: item.LastModified,
      })),
    }
  }

  public async listUploads(query: Record<string, any> = {}, options: CommonRequestOptions = {}): Promise<ListUploadsResult> {
    const result = await this.request({
      method: 'GET',
      objectName: '',
      query: {
        ...(query || {}),
        ...(options.query || {}),
        ...(options.subres || {}),
        uploads: '',
      },
      headers: options.headers,
      timeout: options.timeout,
      successStatuses: [200],
      xmlResponse: true,
    })

    const payload = result.data?.ListMultipartUploadsResult || result.data || {}

    return {
      res: result.res,
      uploads: this.toArray(payload.Upload).map((item: any) => ({
        name: item.Key,
        uploadId: item.UploadId,
        initiated: item.Initiated,
      })),
      bucket: payload.Bucket,
      nextKeyMarker: payload.NextKeyMarker,
      nextUploadIdMarker: payload.NextUploadIdMarker,
      isTruncated: String(payload.IsTruncated) === 'true',
    }
  }

  public async abortMultipartUpload(
    name: string,
    uploadId: string,
    options: CommonRequestOptions = {},
  ): Promise<AbortMultipartUploadResult> {
    const result = await this.request({
      method: 'DELETE',
      objectName: this.objectName(name),
      query: {
        ...(options.query || {}),
        ...(options.subres || {}),
        uploadId,
      },
      headers: options.headers,
      timeout: options.timeout,
      successStatuses: [204],
    })

    return {
      res: result.res,
    }
  }

  public async multipartUpload(name: string, file: OSSFileInput, options: MultipartUploadOptions = {}) {
    this.resetCancelFlag()

    if (options.checkpoint?.uploadId) {
      const checkpoint = { ...options.checkpoint }
      checkpoint.file = file
      return await this.resumeMultipart(checkpoint, options)
    }

    const fileSize = await this.getFileSize(file)
    const minPartSize = 100 * 1024

    if (fileSize < minPartSize) {
      const putResult = await this.put(name, file, options)
      if (options.progress) {
        await options.progress(1, null, putResult.res)
      }

      return {
        res: putResult.res,
        bucket: this.currentOptions.bucket,
        name: this.objectName(name),
        etag: putResult.etag,
        data: putResult.data,
      }
    }

    if (options.partSize && Number(options.partSize) !== Math.floor(Number(options.partSize))) {
      throw toUploadError('multipart-api.ts', ERROR_DICT.INVALID_OPTIONS, new Error('partSize must be an integer'))
    }

    const partSize = this.getPartSize(fileSize, options.partSize)
    const initResult = await this.initMultipartUpload(name, options)

    const checkpoint: MultipartCheckpoint = {
      file,
      name: this.objectName(name),
      fileSize,
      partSize,
      uploadId: initResult.uploadId,
      doneParts: [],
    }

    if (options.progress) {
      await options.progress(0, checkpoint, initResult.res)
    }

    return await this.resumeMultipart(checkpoint, options)
  }

  private async resumeMultipart(checkpoint: MultipartCheckpoint, options: MultipartUploadOptions) {
    if (this.isCancel()) {
      throw this.makeCancelEvent()
    }

    const { file, fileSize, partSize, uploadId, name } = checkpoint
    const internalDoneParts = [...(checkpoint.doneParts || [])]

    const partOffsets = this.divideParts(fileSize, partSize)
    const numParts = partOffsets.length
    const doneSet = new Set(internalDoneParts.map(item => item.number))
    const todo = Array.from({ length: numParts }, (_, index) => index + 1).filter(partNo => !doneSet.has(partNo))

    const parallel = Math.max(1, Number(options.parallel || 5))

    const errors = await this.parallelRun(todo, parallel, async partNo => {
      if (this.isCancel()) {
        throw this.makeCancelEvent()
      }

      const range = partOffsets[partNo - 1]
      const uploaded = await this.uploadPart(name, uploadId, partNo, file, range.start, range.end, options)

      const donePart = {
        number: partNo,
        etag: uploaded.etag,
      }

      internalDoneParts.push(donePart)
      checkpoint.doneParts.push(donePart)

      if (options.progress) {
        await options.progress(internalDoneParts.length / (numParts + 1), checkpoint, uploaded.res)
      }
    })

    if (this.isCancel()) {
      throw this.makeCancelEvent()
    }

    if (errors.length > 0) {
      const firstError = errors[0]
      if (firstError?.name === 'cancel' || firstError?.name === 'abort') {
        throw firstError
      }
      const status = (firstError as any)?.status || (firstError as any)?.cause?.status
      if (status === 404) {
        throw this.makeAbortEvent()
      }
      throw firstError
    }

    return await this.completeMultipartUpload(name, uploadId, internalDoneParts, options)
  }

  private divideParts(fileSize: number, partSize: number) {
    const result: Array<{ start: number; end: number }> = []
    let start = 0
    while (start < fileSize) {
      const end = Math.min(start + partSize, fileSize)
      result.push({ start, end })
      start = end
    }
    return result
  }

  private getPartSize(fileSize: number, partSize?: number) {
    const maxNumParts = 10 * 1000
    const defaultPartSize = 1024 * 1024
    const safeSize = Math.ceil(fileSize / maxNumParts)
    const target = partSize || defaultPartSize
    return Math.max(target, safeSize)
  }

  private async parallelRun(todo: number[], parallel: number, job: (partNo: number) => Promise<void>) {
    const errors: any[] = []
    let cursor = 0

    const worker = async () => {
      while (cursor < todo.length && !this.isCancel() && errors.length === 0) {
        const partNo = todo[cursor]
        cursor += 1
        try {
          await job(partNo)
        } catch (error) {
          if ((error as any)?.name === 'cancel' || (error as any)?.name === 'abort') {
            errors.push(error)
          } else {
            errors.push(toUploadError('multipart-api.ts', ERROR_DICT.UPLOAD_PART, error))
          }
          return
        }
      }
    }

    const workers = Array.from({ length: Math.min(parallel, todo.length) }, () => worker())
    await Promise.all(workers)

    return errors
  }
}
