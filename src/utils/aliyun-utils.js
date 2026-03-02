import Base64 from 'crypto-js/enc-base64'
import HmacSHA1 from 'crypto-js/hmac-sha1'

const isObject = obj => {
  return Object.prototype.toString.call(obj) === '[object Object]'
}

function lowercaseKeyHeader(headers) {
  const lowercaseHeader = {}
  if (isObject(headers)) {
    Object.keys(headers).forEach(key => {
      lowercaseHeader[key.toLowerCase()] = headers[key]
    })
  }
  return lowercaseHeader
}

function buildCanonicalizedResource(resourcePath, parameters) {
  let canonicalizedResource = `${resourcePath}`
  let separatorString = '?'

  if (typeof parameters === 'string' && parameters.trim() !== '') {
    canonicalizedResource += separatorString + parameters
  } else if (Array.isArray(parameters)) {
    parameters.sort()
    canonicalizedResource += separatorString + parameters.join('&')
  } else if (parameters) {
    const compareFunc = (entry1, entry2) => {
      if (entry1[0] > entry2[0]) {
        return 1
      } else if (entry1[0] < entry2[0]) {
        return -1
      }
      return 0
    }
    const processFunc = key => {
      canonicalizedResource += separatorString + key
      if (parameters[key] || parameters[key] === 0) {
        canonicalizedResource += `=${parameters[key]}`
      }
      separatorString = '&'
    }
    Object.keys(parameters).sort(compareFunc).forEach(processFunc)
  }

  return canonicalizedResource
}

export function canonicalString(method, resourcePath, requestHeaders, requestParameters, expires) {
  const headers = lowercaseKeyHeader(requestHeaders)
  const OSS_PREFIX = 'x-oss-'
  const ossHeaders = []
  const headersToSign = {}

  let signContent = [
    method.toUpperCase(),
    headers['content-md5'] || '',
    headers['content-type'],
    expires || headers['x-oss-date'],
  ]

  Object.keys(headers).forEach(key => {
    const lowerKey = key.toLowerCase()
    if (lowerKey.indexOf(OSS_PREFIX) === 0) {
      headersToSign[lowerKey] = String(headers[key]).trim()
    }
  })

  Object.keys(headersToSign)
    .sort()
    .forEach(key => {
      ossHeaders.push(`${key}:${headersToSign[key]}`)
    })

  signContent = signContent.concat(ossHeaders)
  signContent.push(buildCanonicalizedResource(resourcePath, requestParameters || ''))
  return signContent.join('\n')
}

export function computeSignature(accessKeySecret, canonicalString) {
  return Base64.stringify(HmacSHA1(canonicalString, accessKeySecret))
}
