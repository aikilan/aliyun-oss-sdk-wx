# aliyun-oss-sdk-wx

微信小程序环境下的 OSS 对象客户端实现，API 风格对齐 Browser.js 核心对象能力。

## QuickStart

### 1. 安装依赖并构建

```bash
npm install wx
npm run build
```

构建后产物在 `dist/`，入口为 `dist/index.js`。

### 2. 初始化客户端

```ts
import Client from './dist/index'

const client = new Client({
  bucket: 'your-bucket',
  endpoint: 'oss-cn-hangzhou.aliyuncs.com',
  accessKeyId: 'your-ak',
  accessKeySecret: 'your-sk',
  stsToken: 'your-sts-token',
  timeout: 60000,
  retryMax: 1,
  refreshSTSTokenInterval: 300,
  refreshSTSToken: async () => {
    // 由业务服务端返回最新 STS
    const sts = await getSTSFromServer()
    return {
      accessKeyId: sts.accessKeyId,
      accessKeySecret: sts.accessKeySecret,
      stsToken: sts.stsToken,
    }
  },
})
```

## Examples

### Example 1: 直传（put）

```ts
const choose = await wx.chooseMedia({
  count: 1,
  mediaType: ['image', 'video'],
})

const file = choose.tempFiles[0]

const result = await client.put('uploads/demo.mp4', {
  path: file.tempFilePath,
  size: file.size,
  mime: file.type,
})

console.log(result.url, result.etag)
```

### Example 2: 分片上传（multipartUpload）

```ts
const choose = await wx.chooseMedia({ count: 1, mediaType: ['video'] })
const file = choose.tempFiles[0]

let checkpoint: any = null

const res = await client.multipartUpload('videos/big-file.mp4', {
  path: file.tempFilePath,
  size: file.size,
  mime: file.type,
}, {
  partSize: 1024 * 1024, // 1MB
  parallel: 3,
  progress: async (percent, cp) => {
    checkpoint = cp || checkpoint
    console.log('progress:', Math.floor(percent * 100) + '%')
  },
})

console.log('done:', res.name, res.etag)

// 如需取消
// client.cancel()

// 如需断点续传（使用上次 checkpoint）
// await client.multipartUpload('videos/big-file.mp4', { path: file.tempFilePath, size: file.size, mime: file.type }, { checkpoint })
```

## Apis

### 构造参数（`new Client(options)`）

- `bucket: string` 目标 Bucket
- `endpoint: string` OSS Endpoint（支持带/不带协议）
- `accessKeyId: string`
- `accessKeySecret: string`
- `stsToken?: string`
- `secure?: boolean` 默认 `true`
- `cname?: boolean` 是否使用 CNAME
- `timeout?: number` 请求超时（ms）
- `retryMax?: number` 请求重试次数
- `headers?: Record<string, string | number | boolean>`
- `refreshSTSToken?: () => Promise<{ accessKeyId; accessKeySecret; stsToken }>`
- `refreshSTSTokenInterval?: number` STS 刷新间隔（秒）

### 对象操作

- `put(name, file, options?)`
- `append(name, file, options?)`
- `get(name, fileOrOptions?, options?)`
- `head(name, options?)`
- `delete(name, options?)`
- `deleteMulti(names, options?)`
- `copy(name, sourceName, sourceBucketOrOptions?, options?)`
- `list(query?, options?)`
- `listV2(query?, options?)`
- `getObjectUrl(name)`
- `generateObjectUrl(name)`

### 签名 URL

- `signatureUrl(name, options?, strictObjectNameValidation?)`
- `asyncSignatureUrl(name, options?, strictObjectNameValidation?)`

### 分片操作

- `initMultipartUpload(name, options?)`
- `uploadPart(name, uploadId, partNo, file, start, end, options?)`
- `completeMultipartUpload(name, uploadId, parts, options?)`
- `listParts(name, uploadId, query?, options?)`
- `listUploads(query?, options?)`
- `abortMultipartUpload(name, uploadId, options?)`
- `multipartUpload(name, file, options?)`

### 任务控制与通用

- `cancel(abort?)` 取消当前上传任务；可选传入 `{name, uploadId}` 同时触发 `abortMultipartUpload`
- `isCancel()` 当前是否处于取消状态
- `resetCancelFlag()` 重置取消标记
- `useBucket(name)` 动态切换 bucket
- `currentOptions` 读取当前客户端配置快照

## 说明

- 仅覆盖 Browser.js 的核心对象 API，不包含 Bucket 管理、RTMP、ImageClient 等扩展能力。
