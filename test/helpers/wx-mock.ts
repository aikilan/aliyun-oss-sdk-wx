import { URL } from 'node:url'

type MockRequest = {
  method: string
  url: string
  header?: Record<string, string>
  data?: any
  timeout?: number
  responseType?: 'text' | 'arraybuffer'
  pathname: string
  query: URLSearchParams
}

type MockResponse = {
  statusCode: number
  data?: any
  header?: Record<string, string>
}

type Matcher = (request: MockRequest) => boolean

type Handler = (request: MockRequest) => MockResponse | Promise<MockResponse>

export const createWxMock = () => {
  const routes: Array<{ matcher: Matcher; handler: Handler }> = []
  const files = new Map<string, ArrayBuffer>()
  const callLog: MockRequest[] = []

  const getFile = (path: string) => {
    const found = files.get(path)
    if (!found) {
      throw new Error(`file not found: ${path}`)
    }
    return found
  }

  const fs = {
    readFileSync(filePath: string, _encoding?: string, position = 0, length?: number) {
      const buffer = getFile(filePath)
      const end = length === undefined ? buffer.byteLength : Math.min(position + length, buffer.byteLength)
      return buffer.slice(position, end)
    },
    writeFileSync(filePath: string, data: string | ArrayBuffer) {
      if (typeof data === 'string') {
        files.set(filePath, new TextEncoder().encode(data).buffer)
        return
      }
      files.set(filePath, data)
    },
    getFileInfo({
      filePath,
      success,
      fail,
    }: {
      filePath: string
      success: (res: { size: number }) => void
      fail: (err: any) => void
    }) {
      try {
        const buffer = getFile(filePath)
        success({ size: buffer.byteLength })
      } catch (error) {
        fail(error)
      }
    },
  }

  const wxMock = {
    request(options: WechatMiniprogram.RequestOption) {
      let aborted = false
      const task = {
        abort() {
          aborted = true
          options.fail?.({ errMsg: 'request:fail abort' } as any)
        },
      } as WechatMiniprogram.RequestTask

      setTimeout(async () => {
        if (aborted) {
          return
        }

        try {
          const parsed = new URL(options.url as string)
          const request: MockRequest = {
            method: String(options.method || 'GET').toUpperCase(),
            url: String(options.url),
            header: options.header as Record<string, string> | undefined,
            data: (options as any).data,
            timeout: options.timeout,
            responseType: options.responseType,
            pathname: parsed.pathname,
            query: parsed.searchParams,
          }

          callLog.push(request)

          const route = routes.find(item => item.matcher(request))
          if (!route) {
            throw new Error(`No route matched: ${request.method} ${request.pathname} ${parsed.search}`)
          }

          const response = await route.handler(request)
          if (aborted) {
            return
          }

          options.success?.({
            errMsg: 'request:ok',
            statusCode: response.statusCode,
            data: response.data,
            header: response.header || {},
            cookies: [],
            profile: {} as any,
          })
        } catch (error: any) {
          if (!aborted) {
            options.fail?.({ errMsg: String(error?.message || error) } as any)
          }
        }
      }, 0)

      return task
    },
    getFileSystemManager() {
      return fs as any
    },
    arrayBufferToBase64(buffer: ArrayBuffer) {
      return Buffer.from(buffer).toString('base64')
    },
  }

  return {
    wx: wxMock,
    routes,
    files,
    callLog,
    addRoute(matcher: Matcher, handler: Handler) {
      routes.push({ matcher, handler })
    },
    seedFile(filePath: string, content: string | Uint8Array | ArrayBuffer) {
      if (typeof content === 'string') {
        files.set(filePath, new TextEncoder().encode(content).buffer)
        return
      }
      if (content instanceof Uint8Array) {
        files.set(filePath, content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer)
        return
      }
      files.set(filePath, content)
    },
    readFileText(filePath: string) {
      return new TextDecoder().decode(new Uint8Array(getFile(filePath)))
    },
  }
}
