import assert from 'node:assert/strict'
import test from 'node:test'

import OSSClientWX from '../src/client'
import { createWxMock } from './helpers/wx-mock'

const createClient = (wxMock: ReturnType<typeof createWxMock>, overrides: Partial<ConstructorParameters<typeof OSSClientWX>[0]> = {}) => {
  ;(globalThis as any).wx = wxMock.wx
  return new OSSClientWX({
    bucket: 'demo-bucket',
    endpoint: 'oss-cn-hangzhou.aliyuncs.com',
    accessKeyId: 'ak',
    accessKeySecret: 'sk',
    stsToken: 'sts-old',
    ...overrides,
  })
}

test('对象核心 API: put/get/head/copy/delete/listV2', async () => {
  const wxMock = createWxMock()
  const client = createClient(wxMock)

  wxMock.addRoute(
    req => req.method === 'PUT' && req.pathname === '/hello.txt' && !req.query.has('partNumber'),
    () => ({ statusCode: 200, header: { etag: 'etag-put' }, data: '' }),
  )
  wxMock.addRoute(
    req => req.method === 'GET' && req.pathname === '/hello.txt',
    () => ({ statusCode: 200, data: new TextEncoder().encode('hello').buffer }),
  )
  wxMock.addRoute(
    req => req.method === 'HEAD' && req.pathname === '/hello.txt',
    () => ({ statusCode: 200, header: { 'x-oss-meta-owner': 'alice' }, data: '' }),
  )
  wxMock.addRoute(
    req => req.method === 'PUT' && req.pathname === '/copied.txt' && !!req.header?.['x-oss-copy-source'],
    () => ({
      statusCode: 200,
      data: '<?xml version="1.0"?><CopyObjectResult><ETag>etag-copy</ETag><LastModified>2026-01-01T00:00:00.000Z</LastModified></CopyObjectResult>',
    }),
  )
  wxMock.addRoute(
    req => req.method === 'DELETE' && req.pathname === '/hello.txt',
    () => ({ statusCode: 204, data: '' }),
  )
  wxMock.addRoute(
    req => req.method === 'GET' && req.pathname === '/' && req.query.get('list-type') === '2',
    () => ({
      statusCode: 200,
      data: `<?xml version="1.0"?><ListBucketResult>
<KeyCount>1</KeyCount>
<IsTruncated>false</IsTruncated>
<Contents><Key>hello.txt</Key><ETag>etag-put</ETag><Size>5</Size><Type>Normal</Type></Contents>
</ListBucketResult>`,
    }),
  )

  const putResult = await client.put('hello.txt', new TextEncoder().encode('hello').buffer)
  assert.equal(putResult.name, 'hello.txt')
  assert.equal(putResult.etag, 'etag-put')

  const getResult = await client.get('hello.txt')
  assert.equal(new TextDecoder().decode(new Uint8Array(getResult.content as ArrayBuffer)), 'hello')

  const headResult = await client.head('hello.txt')
  assert.equal(headResult.meta?.owner, 'alice')

  const copyResult = await client.copy('copied.txt', 'hello.txt')
  assert.equal(copyResult.data?.etag, 'etag-copy')

  const listResult = await client.listV2({})
  assert.equal(listResult.objects.length, 1)
  assert.equal(listResult.objects[0].name, 'hello.txt')

  const deleteResult = await client.delete('hello.txt')
  assert.equal(deleteResult.res.statusCode, 204)
})

test('签名 URL: signatureUrl + asyncSignatureUrl 刷新 STS', async () => {
  const wxMock = createWxMock()
  let refreshCalled = 0
  const client = createClient(wxMock, {
    refreshSTSToken: async () => {
      refreshCalled += 1
      return {
        accessKeyId: 'ak-new',
        accessKeySecret: 'sk-new',
        stsToken: 'sts-new',
      }
    },
    refreshSTSTokenInterval: 0,
  })

  const signed = client.signatureUrl('signed.txt', { expires: 120, method: 'GET' })
  const parsedSigned = new URL(signed)
  assert.equal(parsedSigned.searchParams.get('security-token'), 'sts-old')
  assert.ok(parsedSigned.searchParams.get('Signature'))

  const asyncSigned = await client.asyncSignatureUrl('signed.txt', { expires: 120, method: 'GET' })
  const parsedAsyncSigned = new URL(asyncSigned)

  assert.equal(refreshCalled, 1)
  assert.equal(parsedAsyncSigned.searchParams.get('security-token'), 'sts-new')
  assert.equal(parsedAsyncSigned.searchParams.get('OSSAccessKeyId'), 'ak-new')
})

test('multipartUpload 小文件走 put', async () => {
  const wxMock = createWxMock()
  const client = createClient(wxMock)

  let putCalled = 0
  const progress: number[] = []

  wxMock.addRoute(
    req => req.method === 'PUT' && req.pathname === '/small.bin' && !req.query.has('partNumber'),
    () => {
      putCalled += 1
      return { statusCode: 200, header: { etag: 'etag-small' }, data: '' }
    },
  )

  const result = await client.multipartUpload('small.bin', new Uint8Array([1, 2, 3, 4]), {
    progress: async p => {
      progress.push(p)
    },
  })

  assert.equal(putCalled, 1)
  assert.equal(result.etag, 'etag-small')
  assert.equal(progress.at(-1), 1)
})

test('multipartUpload 支持 checkpoint 续传', async () => {
  const wxMock = createWxMock()
  const client = createClient(wxMock)

  const data = new Uint8Array(300 * 1024)
  let partCount = 0

  wxMock.addRoute(
    req => req.method === 'PUT' && req.pathname === '/big.bin' && req.query.get('uploadId') === 'u1',
    req => {
      partCount += 1
      const partNumber = req.query.get('partNumber')
      return { statusCode: 200, header: { etag: `etag-${partNumber}` }, data: '' }
    },
  )

  wxMock.addRoute(
    req => req.method === 'POST' && req.pathname === '/big.bin' && req.query.get('uploadId') === 'u1',
    () => ({
      statusCode: 200,
      data: '<?xml version="1.0"?><CompleteMultipartUploadResult><Location>https://demo/big.bin</Location><Bucket>demo-bucket</Bucket><Key>big.bin</Key><ETag>etag-final</ETag></CompleteMultipartUploadResult>',
    }),
  )

  const checkpoint = {
    file: data,
    name: 'big.bin',
    fileSize: data.byteLength,
    partSize: 100 * 1024,
    uploadId: 'u1',
    doneParts: [{ number: 1, etag: 'etag-1' }],
  }

  const result = await client.multipartUpload('big.bin', data, {
    checkpoint,
    partSize: 100 * 1024,
    parallel: 2,
  })

  assert.equal(partCount, 2)
  assert.equal(result.name, 'big.bin')
  assert.equal(result.etag, 'etag-final')
})

test('cancel 会中断分片上传', async () => {
  const wxMock = createWxMock()
  const client = createClient(wxMock)

  const data = new Uint8Array(420 * 1024)
  let uploadPartCalls = 0

  wxMock.addRoute(
    req => req.method === 'POST' && req.pathname === '/cancel.bin' && req.query.has('uploads'),
    () => ({
      statusCode: 200,
      data: '<?xml version="1.0"?><InitiateMultipartUploadResult><Bucket>demo-bucket</Bucket><Key>cancel.bin</Key><UploadId>u-cancel</UploadId></InitiateMultipartUploadResult>',
    }),
  )

  wxMock.addRoute(
    req => req.method === 'PUT' && req.pathname === '/cancel.bin' && req.query.get('uploadId') === 'u-cancel',
    async () => {
      uploadPartCalls += 1
      await new Promise(resolve => setTimeout(resolve, 40))
      return {
        statusCode: 200,
        header: { etag: `etag-${uploadPartCalls}` },
        data: '',
      }
    },
  )

  const promise = client.multipartUpload('cancel.bin', data, {
    partSize: 100 * 1024,
    parallel: 2,
  })

  setTimeout(() => {
    client.cancel()
  }, 5)

  await assert.rejects(promise, (error: any) => error?.name === 'cancel')
  assert.ok(uploadPartCalls < 5)
})

test('abortMultipartUpload 可用', async () => {
  const wxMock = createWxMock()
  const client = createClient(wxMock)

  wxMock.addRoute(
    req => req.method === 'DELETE' && req.pathname === '/abort.bin' && req.query.get('uploadId') === 'u-abort',
    () => ({ statusCode: 204, data: '' }),
  )

  const result = await client.abortMultipartUpload('abort.bin', 'u-abort')
  assert.equal(result.res.statusCode, 204)
})
