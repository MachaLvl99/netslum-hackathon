/**
 * GENERATED CODE - DO NOT MODIFY
 */
import {
  type LexiconDoc,
  Lexicons,
  ValidationError,
  type ValidationResult,
} from '@atproto/lexicon'
import { type $Typed, is$typed, maybe$typed } from './util.js'

export const schemaDict = {
  ShMachaNetslumSite: {
    lexicon: 1,
    id: 'sh.macha.netslumSite',
    defs: {
      main: {
        type: 'record',
        key: 'literal:self',
        record: {
          type: 'object',
          required: ['version', 'slug', 'revision', 'files', 'publishedAt'],
          properties: {
            version: {
              type: 'integer',
              minimum: 1,
              maximum: 1,
            },
            slug: {
              type: 'string',
              minLength: 1,
              maxLength: 63,
              knownValues: [],
            },
            revision: {
              type: 'string',
              minLength: 64,
              maxLength: 64,
            },
            files: {
              type: 'array',
              minLength: 1,
              maxLength: 64,
              items: {
                type: 'ref',
                ref: 'lex:sh.macha.netslumSite#file',
              },
            },
            publishedAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
      file: {
        type: 'object',
        required: ['path', 'mimeType', 'size', 'sha256', 'blob'],
        properties: {
          path: {
            type: 'string',
            maxLength: 128,
          },
          mimeType: {
            type: 'string',
            maxLength: 100,
          },
          size: {
            type: 'integer',
            minimum: 0,
            maximum: 524288,
          },
          sha256: {
            type: 'string',
            minLength: 64,
            maxLength: 64,
          },
          blob: {
            type: 'blob',
            accept: ['*/*'],
            maxSize: 524288,
          },
        },
      },
    },
  },
} as const satisfies Record<string, LexiconDoc>
export const schemas = Object.values(schemaDict) satisfies LexiconDoc[]
export const lexicons: Lexicons = new Lexicons(schemas)

export function validate<T extends { $type: string }>(
  v: unknown,
  id: string,
  hash: string,
  requiredType: true,
): ValidationResult<T>
export function validate<T extends { $type?: string }>(
  v: unknown,
  id: string,
  hash: string,
  requiredType?: false,
): ValidationResult<T>
export function validate(
  v: unknown,
  id: string,
  hash: string,
  requiredType?: boolean,
): ValidationResult {
  return (requiredType ? is$typed : maybe$typed)(v, id, hash)
    ? lexicons.validate(`${id}#${hash}`, v)
    : {
        success: false,
        error: new ValidationError(
          `Must be an object with "${hash === 'main' ? id : `${id}#${hash}`}" $type property`,
        ),
      }
}

export const ids = {
  ShMachaNetslumSite: 'sh.macha.netslumSite',
} as const
