import Client from './client'

export { ERROR_DICT, UploadError, toUploadError } from './types'
export { Client }
export const OSSClientWX = Client
export type {
  AbortEvent,
  AbortMultipartUploadResult,
  AppendOptions,
  CallbackOptions,
  CancelAbortOptions,
  CancelEvent,
  CommonRequestOptions,
  CompleteMultipartUploadResult,
  CopyOptions,
  CopyResult,
  DeleteMultiName,
  DeleteResult,
  GetOptions,
  GetResult,
  HeadResult,
  HTTPMethod,
  InitMultipartUploadResult,
  ListPartsResult,
  ListResult,
  ListedObject,
  ListUploadsResult,
  ListV2Result,
  MultipartCheckpoint,
  MultipartPart,
  MultipartUploadOptions,
  OSSClientOptions,
  OSSFileInput,
  PutOptions,
  PutResult,
  RefreshSTSTokenResult,
  SignatureUrlOptions,
  UploadPartResult,
} from './types-client'

export default Client
