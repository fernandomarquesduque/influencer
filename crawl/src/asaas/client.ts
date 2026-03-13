/**
 * Cliente HTTP para API Asaas v3.
 * Autenticação: header access_token (não Authorization Bearer).
 * Base URL por ambiente (sandbox/production).
 */

const ASAAS_ENV = (process.env.ASAAS_ENV ?? 'sandbox').toLowerCase();
const ASAAS_API_KEY = process.env.ASAAS_API_KEY ?? '';

const BASE_URL =
  process.env.ASAAS_BASE_URL?.trim() ||
  (ASAAS_ENV === 'production'
    ? 'https://api.asaas.com/v3'
    : 'https://sandbox.asaas.com/api/v3');

export interface AsaasErrorItem {
  code?: string;
  description?: string;
}

export interface AsaasApiError {
  errors?: AsaasErrorItem[];
}

function getErrorMessage(err: AsaasApiError): string {
  const list = err?.errors;
  if (Array.isArray(list) && list.length > 0 && list[0].description) {
    return list[0].description;
  }
  return 'Erro na API Asaas';
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const url = path.startsWith('http') ? path : `${BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    access_token: ASAAS_API_KEY,
  };
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & AsaasApiError;
  if (!res.ok) {
    throw new Error(getErrorMessage(data as AsaasApiError));
  }
  return data;
}

export interface AsaasCustomer {
  id?: string;
  name?: string;
  email?: string;
  cpfCnpj?: string;
  externalReference?: string;
}

export interface AsaasPayment {
  id?: string;
  customer?: string;
  value?: number;
  dueDate?: string;
  status?: string;
  billingType?: string;
  invoiceUrl?: string;
  bankSlipUrl?: string;
  invoiceNumber?: string;
  deleted?: boolean;
  /** PIX: código para copia e cola */
  pixTransaction?: { qrCode?: string; payload?: string };
}

/** GET myAccount - status da conta */
export async function getMyAccount(): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>('GET', 'myAccount');
}

/** GET finance/getCurrentBalance - saldo atual */
export async function getCurrentBalance(): Promise<{ balance?: number }> {
  return request<{ balance?: number }>('GET', 'finance/getCurrentBalance');
}

/** GET customers?cpfCnpj=xxx - busca por CPF/CNPJ */
export async function findCustomersByCpfCnpj(cpfCnpj: string): Promise<{ data?: AsaasCustomer[] }> {
  const qs = new URLSearchParams({ cpfCnpj: cpfCnpj.replace(/\D/g, '') });
  return request<{ data?: AsaasCustomer[] }>(`GET`, `customers?${qs.toString()}`);
}

/** GET customers?externalReference=xxx - busca pelo identificador do nosso sistema */
export async function findCustomersByExternalReference(externalRef: string): Promise<{ data?: AsaasCustomer[] }> {
  const qs = new URLSearchParams({ externalReference: externalRef });
  return request<{ data?: AsaasCustomer[] }>('GET', `customers?${qs.toString()}`);
}

/** POST customers - criar cliente */
export async function createCustomer(payload: {
  name: string;
  email: string;
  cpfCnpj?: string;
  phone?: string;
  externalReference?: string;
  address?: string;
  addressNumber?: string;
  province?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}): Promise<AsaasCustomer> {
  return request<AsaasCustomer>('POST', 'customers', payload);
}

/** POST payments - criar cobrança (PIX ou BOLETO) */
export async function createPayment(payload: {
  customer: string;
  value: number;
  dueDate: string;
  billingType: 'PIX' | 'BOLETO';
  description?: string;
  externalReference?: string;
}): Promise<AsaasPayment & { pixTransaction?: { qrCode?: string; payload?: string } }> {
  return request<AsaasPayment & { pixTransaction?: { qrCode?: string; payload?: string } }>(
    'POST',
    'payments',
    payload
  );
}

/** GET payments/:id - detalhe do pagamento */
export async function getPayment(id: string): Promise<AsaasPayment> {
  return request<AsaasPayment>('GET', `payments/${encodeURIComponent(id)}`);
}

/** Verifica se o módulo está configurado (API key definida). */
export function isAsaasConfigured(): boolean {
  return Boolean(ASAAS_API_KEY && ASAAS_API_KEY.trim());
}
