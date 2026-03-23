/**
 * Cliente HTTP para API Asaas v3.
 * Autenticação: header access_token (não Authorization Bearer).
 * Base URL por ambiente (sandbox/production).
 */

/**
 * Leitura lazy de env: server.ts chama dotenv depois dos imports;
 * se lermos process.env no topo do módulo, ASAAS_API_KEY fica sempre vazio.
 */
function getAsaasEnv(): string {
  return (process.env.ASAAS_ENV ?? 'sandbox').toLowerCase();
}

function getBaseUrl(): string {
  const custom = process.env.ASAAS_BASE_URL?.trim();
  if (custom) return custom;
  return getAsaasEnv() === 'production'
    ? 'https://api.asaas.com/v3'
    : 'https://sandbox.asaas.com/api/v3';
}

function getAsaasApiKey(): string {
  return process.env.ASAAS_API_KEY ?? '';
}

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
  const base = getBaseUrl();
  const url = path.startsWith('http') ? path : `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    access_token: getAsaasApiKey(),
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

/** PUT customers/:id - atualizar (ex.: incluir CPF/CNPJ para boleto) */
export async function updateCustomer(
  id: string,
  payload: Partial<{
    name: string;
    email: string;
    cpfCnpj: string;
    phone: string;
    externalReference: string;
  }>
): Promise<AsaasCustomer> {
  return request<AsaasCustomer>('PUT', `customers/${encodeURIComponent(id)}`, payload);
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

/** Resposta de GET payments/:id/pixQrCode (payload copia-e-cola + imagem base64) */
export interface AsaasPixQrCodeResponse {
  encodedImage?: string;
  payload?: string;
  expirationDate?: string;
  description?: string;
}

/** QR Code PIX — em muitos casos o POST /payments não traz pixTransaction; é preciso este GET. */
export async function getPaymentPixQrCode(paymentId: string): Promise<AsaasPixQrCodeResponse> {
  return request<AsaasPixQrCodeResponse>('GET', `payments/${encodeURIComponent(paymentId)}/pixQrCode`);
}

/**
 * Monta o código PIX copia-e-cola: primeiro tenta o corpo do POST; se PIX e ainda vazio, consulta pixQrCode.
 */
export async function resolvePixCopyPasteAfterCreate(
  billingType: 'PIX' | 'BOLETO',
  asaasPaymentId: string | null | undefined,
  asaasPayment: AsaasPayment
): Promise<string | null> {
  let pix =
    asaasPayment?.pixTransaction?.payload ??
    asaasPayment?.pixTransaction?.qrCode ??
    null;
  if (billingType === 'PIX' && asaasPaymentId && !pix) {
    try {
      const qr = await getPaymentPixQrCode(asaasPaymentId);
      pix = qr?.payload ?? null;
    } catch (e) {
      console.warn('[asaas] getPaymentPixQrCode:', e instanceof Error ? e.message : e);
    }
  }
  return pix;
}

/** DELETE payments/:id — remove cobrança pendente no Asaas (exige PAYMENT:WRITE). */
export async function deleteAsaasPayment(paymentId: string): Promise<void> {
  const base = getBaseUrl();
  const url = `${base.replace(/\/$/, '')}/payments/${encodeURIComponent(paymentId)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { access_token: getAsaasApiKey() },
  });
  const data = (await res.json().catch(() => ({}))) as AsaasApiError;
  if (!res.ok) {
    throw new Error(getErrorMessage(data));
  }
}

/** Verifica se o módulo está configurado (API key definida). */
export function isAsaasConfigured(): boolean {
  const k = getAsaasApiKey();
  return Boolean(k && k.trim());
}
