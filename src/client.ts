import MultipartAPI from './multipart-api'
import { OSSClientOptions } from './types-client'

export class Client extends MultipartAPI {
  constructor(options: OSSClientOptions) {
    super(options)
  }
}

export default Client
