# aliyun-oss-sdk-wx

微信小程序 OSS SDK（npm 包）。

定位：面向业务项目直接接入，提供 Browser.js 核心对象 API（对象上传/下载/分片/签名 URL）。

## QuickStart

### 1. 安装

```bash
npm install aliyun-oss-sdk-wx
```

### 2. 小程序工程启用 npm

在微信开发者工具中：

1. 勾选「使用 npm 模块」
2. 点击「工具 -> 构建 npm」

### 3. 初始化客户端

```ts
import Client from 'aliyun-oss-sdk-wx'

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
    // 从你的业务服务端获取最新 STS
    const sts = await getSTSFromServer()
    return {
      accessKeyId: sts.accessKeyId,
      accessKeySecret: sts.accessKeySecret,
      stsToken: sts.stsToken,
    }
  },
})
```

如果你的项目使用 `require`：

```js
const Client = require('aliyun-oss-sdk-wx').default
```

## Example

### 示例 1：直传（put）

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

console.log('url:', result.url)
console.log('etag:', result.etag)
```

### 示例 2：分片上传（multipartUpload）

```ts
const choose = await wx.chooseMedia({
  count: 1,
  mediaType: ['video'],
})

const file = choose.tempFiles[0]
let checkpoint: any = null

const result = await client.multipartUpload(
  'videos/big-file.mp4',
  {
    path: file.tempFilePath,
    size: file.size,
    mime: file.type,
  },
  {
    partSize: 1024 * 1024, // 1MB
    parallel: 3,
    progress: async (percent, cp) => {
      checkpoint = cp || checkpoint
      console.log('progress:', Math.floor(percent * 100) + '%')
    },
  },
)

console.log('done:', result.name, result.etag)

// 取消上传
// client.cancel()

// 断点续传（复用 checkpoint）
// await client.multipartUpload('videos/big-file.mp4', {
//   path: file.tempFilePath,
//   size: file.size,
//   mime: file.type,
// }, {
//   checkpoint,
// })
```

## Apis

### Client 构造参数（`new Client(options)`）

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
- `refreshSTSTokenInterval?: number` 刷新间隔（秒）

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

### 分片上传

- `initMultipartUpload(name, options?)`
- `uploadPart(name, uploadId, partNo, file, start, end, options?)`
- `completeMultipartUpload(name, uploadId, parts, options?)`
- `listParts(name, uploadId, query?, options?)`
- `listUploads(query?, options?)`
- `abortMultipartUpload(name, uploadId, options?)`
- `multipartUpload(name, file, options?)`

### 任务控制

- `cancel(abort?)`
- `isCancel()`
- `resetCancelFlag()`
- `useBucket(name)`
- `currentOptions`

## 输入文件类型

`file` 支持：

- `string`（本地临时文件路径）
- `ArrayBuffer`
- `Uint8Array`
- `{ path: string; size?: number; mime?: string }`

## 说明

- 当前仅覆盖 Browser.js 核心对象 API，不包含 Bucket 管理、RTMP、ImageClient。
