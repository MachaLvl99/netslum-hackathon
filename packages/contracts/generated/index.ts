/**
 * GENERATED CODE - DO NOT MODIFY
 */
import {
  XrpcClient,
  type FetchHandler,
  type FetchHandlerOptions,
} from '@atproto/xrpc'
import { schemas } from './lexicons.js'
import { CID } from 'multiformats/cid'
import { type OmitKey, type Un$Typed } from './util.js'
import * as ShMachaNetslumSite from './types/sh/macha/netslumSite.js'

export * as ShMachaNetslumSite from './types/sh/macha/netslumSite.js'

export class AtpBaseClient extends XrpcClient {
  sh: ShNS

  constructor(options: FetchHandler | FetchHandlerOptions) {
    super(options, schemas)
    this.sh = new ShNS(this)
  }

  /** @deprecated use `this` instead */
  get xrpc(): XrpcClient {
    return this
  }
}

export class ShNS {
  _client: XrpcClient
  macha: ShMachaNS

  constructor(client: XrpcClient) {
    this._client = client
    this.macha = new ShMachaNS(client)
  }
}

export class ShMachaNS {
  _client: XrpcClient
  netslumSite: ShMachaNetslumSiteRecord

  constructor(client: XrpcClient) {
    this._client = client
    this.netslumSite = new ShMachaNetslumSiteRecord(client)
  }
}

export class ShMachaNetslumSiteRecord {
  _client: XrpcClient

  constructor(client: XrpcClient) {
    this._client = client
  }

  async list(
    params: OmitKey<ComAtprotoRepoListRecords.QueryParams, 'collection'>,
  ): Promise<{
    cursor?: string
    records: { uri: string; value: ShMachaNetslumSite.Record }[]
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'sh.macha.netslumSite',
      ...params,
    })
    return res.data
  }

  async get(
    params: OmitKey<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{ uri: string; cid: string; value: ShMachaNetslumSite.Record }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'sh.macha.netslumSite',
      ...params,
    })
    return res.data
  }

  async create(
    params: OmitKey<
      ComAtprotoRepoCreateRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<ShMachaNetslumSite.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'sh.macha.netslumSite'
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      {
        collection,
        rkey: 'self',
        ...params,
        record: { ...record, $type: collection },
      },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async put(
    params: OmitKey<
      ComAtprotoRepoPutRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<ShMachaNetslumSite.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'sh.macha.netslumSite'
    const res = await this._client.call(
      'com.atproto.repo.putRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async delete(
    params: OmitKey<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'sh.macha.netslumSite', ...params },
      { headers },
    )
  }
}
