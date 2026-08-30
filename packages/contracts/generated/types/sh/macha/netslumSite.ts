/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { type ValidationResult, BlobRef } from '@atproto/lexicon'
import { CID } from 'multiformats/cid'
import { validate as _validate } from '../../../lexicons.js'
import {
  type $Typed,
  is$typed as _is$typed,
  type OmitKey,
} from '../../../util.js'

const is$typed = _is$typed,
  validate = _validate
const id = 'sh.macha.netslumSite'

export interface Main {
  $type: 'sh.macha.netslumSite'
  version: number
  slug: string
  revision: string
  files: File[]
  publishedAt: string
  [k: string]: unknown
}

const hashMain = 'main'

export function isMain<V>(v: V) {
  return is$typed(v, id, hashMain)
}

export function validateMain<V>(v: V) {
  return validate<Main & V>(v, id, hashMain, true)
}

export {
  type Main as Record,
  isMain as isRecord,
  validateMain as validateRecord,
}

export interface File {
  $type?: 'sh.macha.netslumSite#file'
  path: string
  mimeType: string
  size: number
  sha256: string
  blob: BlobRef
}

const hashFile = 'file'

export function isFile<V>(v: V) {
  return is$typed(v, id, hashFile)
}

export function validateFile<V>(v: V) {
  return validate<File & V>(v, id, hashFile)
}
