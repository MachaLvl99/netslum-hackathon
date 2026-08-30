import { NetslumError } from "@netslum/contracts";
import type { CloudflareEnv } from "../../types.js";

export class CloudflareProvisioner {
  private readonly accountId: string;
  private readonly apiToken: string;

  constructor(env: CloudflareEnv) {
    this.accountId = env.CLOUDFLARE_ACCOUNT_ID;
    this.apiToken = env.CLOUDFLARE_API_TOKEN;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    if (!this.accountId || !this.apiToken) {
      throw new NetslumError("SERVERLESS_UNAVAILABLE", "Cloudflare credentials not configured", 503);
    }
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}${endpoint}`;
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${this.apiToken}`);
    const response = await fetch(url, { ...options, headers, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      throw new NetslumError("WORKER_FAILED", "Cloudflare provisioning API request failed", 502);
    }
    const result: { success?: boolean; result?: T; errors?: Array<{ message: string }> } = await response.json();
    if (!result.success) {
      throw new NetslumError("WORKER_FAILED", "Cloudflare API returned failure envelope", 502);
    }
    return result.result as NonNullable<T>;
  }

  async getOrCreateKvNamespace(title: string): Promise<string> {
    const list = await this.request<Array<{ id: string; title: string }>>("/storage/kv/namespaces?per_page=100");
    const existing = list?.find((item) => item.title === title);
    if (existing) return existing.id;
    const created = await this.request<{ id: string }>("/storage/kv/namespaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title })
    });
    return created.id;
  }

  async deleteKvNamespace(namespaceId: string): Promise<void> {
    await this.request(`/storage/kv/namespaces/${encodeURIComponent(namespaceId)}`, { method: "DELETE" }).catch(() => undefined);
  }

  async putDispatchScript(namespace: string, scriptName: string, scriptCode: string, kvNamespaceId: string): Promise<void> {
    const form = new FormData();
    const metadata = {
      main_module: "worker.js",
      bindings: [{ type: "kv_namespace", name: "NETSLUM_KV", namespace_id: kvNamespaceId }]
    };
    form.append("metadata", JSON.stringify(metadata));
    form.append("worker.js", new Blob([scriptCode], { type: "application/javascript+module" }), "worker.js");
    await this.request(`/workers/dispatch/namespaces/${encodeURIComponent(namespace)}/scripts/${encodeURIComponent(scriptName)}`, {
      method: "PUT",
      body: form
    });
  }

  async deleteDispatchScript(namespace: string, scriptName: string): Promise<void> {
    await this.request(`/workers/dispatch/namespaces/${encodeURIComponent(namespace)}/scripts/${encodeURIComponent(scriptName)}`, {
      method: "DELETE"
    }).catch(() => undefined);
  }
}
