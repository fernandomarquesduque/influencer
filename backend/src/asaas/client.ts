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

/** true quando as requisições vão para o sandbox Asaas. */
export function isAsaasSandbox(): boolean {
  return getBaseUrl().includes('sandbox');
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
  return 'Erro no provedor de pagamentos';
}

/** `ASAAS_DEBUG=1` ou ambiente não production — JSON bruto das respostas (URLs / nomes de campo). */
function shouldLogAsaasResponses(): boolean {
  return process.env.ASAAS_DEBUG === '1' || process.env.NODE_ENV !== 'production';
}

function logAsaasJson(context: string, data: unknown): void {
  if (!shouldLogAsaasResponses()) return;
  try {
    const trimmed = JSON.stringify(
      data,
      (_k, v) => {
        if (typeof v === 'string' && v.length > 200 && /^[A-Za-z0-9+/=_-]+$/.test(v.slice(0, 64))) {
          return `[string ${v.length} chars]`;
        }
        return v;
      },
      2
    );
    console.log(`[asaas] ${context}\n${trimmed}`);
  } catch {
    console.log(`[asaas] ${context}`, data);
  }
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
  externalReference?: string;
  /** Quando a cobrança veio de uma assinatura, id da assinatura (string ou objeto com id). */
  subscription?: string | { id?: string };
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

/** Alguns ambientes/respostas devolvem lista ({ data: [...] }) em vez de um único cliente. */
function normalizeCustomerCreateResponse(
  raw: AsaasCustomer & { data?: AsaasCustomer[]; object?: string },
  payload: { externalReference?: string; email?: string }
): AsaasCustomer {
  const list = raw?.data;
  if (Array.isArray(list) && list.length > 0) {
    const ext = payload.externalReference;
    if (ext) {
      const byRef = list.find((c) => c.externalReference === ext && c.id);
      if (byRef) return byRef;
    }
    const email = payload.email;
    if (email) {
      const byEmail = list.find((c) => c.email === email && c.id);
      if (byEmail) return byEmail;
    }
    const first = list.find((c) => c.id);
    if (first) return first;
  }
  if (raw?.id) return raw;
  return raw;
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
  const raw = await request<AsaasCustomer & { data?: AsaasCustomer[]; object?: string }>(
    'POST',
    'customers',
    payload
  );
  return normalizeCustomerCreateResponse(raw, payload);
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

type PaymentCreateRaw = AsaasPayment & {
  data?: AsaasPayment[];
  object?: string;
  pixTransaction?: { qrCode?: string; payload?: string };
};

/** GET payments?externalReference= — localizar cobrança quando o POST retorna listagem incorreta. */
export async function findPaymentsByExternalReference(
  externalRef: string
): Promise<{ data?: AsaasPayment[] }> {
  const qs = new URLSearchParams({ externalReference: externalRef });
  return request<{ data?: AsaasPayment[] }>('GET', `payments?${qs.toString()}`);
}

function mergePixFromRaw(
  p: AsaasPayment,
  raw: PaymentCreateRaw
): AsaasPayment & { pixTransaction?: { qrCode?: string; payload?: string } } {
  return { ...p, pixTransaction: p.pixTransaction ?? raw.pixTransaction };
}

/**
 * POST /payments deve retornar um único objeto payment.
 * Se vier `object: "list"` (bug/proxy/URL), NUNCA usar data[0] — seria outra cobrança (ex. cartão CONFIRMED).
 */
function pickPaymentFromCreateRaw(
  raw: PaymentCreateRaw,
  payload: { externalReference?: string }
): AsaasPayment | null {
  const isList = (raw as { object?: string }).object === 'list';
  if (raw?.id && !isList) {
    return raw;
  }
  const list = raw?.data;
  if (Array.isArray(list) && list.length > 0) {
    const ext = payload.externalReference;
    if (ext) {
      const byRef = list.find((p) => p.externalReference === ext && p.id);
      if (byRef) return byRef;
    }
    if (isList) {
      return null;
    }
    const first = list.find((p) => p.id);
    if (first) return first;
  }
  if (raw?.id) return raw;
  return null;
}

function assertCreatedPaymentMatchesPayload(
  p: AsaasPayment,
  payload: { billingType: 'PIX' | 'BOLETO'; value: number }
): void {
  const remoteBt = (p.billingType ?? '').trim().toUpperCase();
  const wantBt = payload.billingType.toUpperCase();
  if (remoteBt && wantBt && remoteBt !== wantBt) {
    throw new Error(
      `[asaas] Cobrança retornada tem billingType=${remoteBt}, esperado ${wantBt}. O POST pode ter devolvido listagem de outras cobranças — confira ASAAS_BASE_URL.`
    );
  }
  const v = p.value;
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (Math.abs(v - payload.value) > 0.009) {
      throw new Error(
        `[asaas] Valor da cobrança no Asaas (${v}) não confere com o pedido (${payload.value}). Recusado para não gravar ID errado.`
      );
    }
  }
}

async function resolvePaymentAfterPost(
  raw: PaymentCreateRaw,
  payload: { externalReference?: string; billingType: 'PIX' | 'BOLETO'; value: number }
): Promise<AsaasPayment & { pixTransaction?: { qrCode?: string; payload?: string } }> {
  let p = pickPaymentFromCreateRaw(raw, payload);
  const ext = payload.externalReference?.trim();
  if (ext && !p?.id) {
    try {
      const found = await findPaymentsByExternalReference(ext);
      const rows = found?.data ?? [];
      const hit = rows.find((row) => row.externalReference === ext && row.id);
      if (hit) {
        p = hit;
      }
    } catch (e) {
      console.warn('[asaas] findPaymentsByExternalReference:', e instanceof Error ? e.message : e);
    }
  }
  if (!p?.id) {
    throw new Error(
      '[asaas] Não foi possível obter a cobrança criada: POST /payments retornou listagem sem o seu externalReference. Verifique ASAAS_BASE_URL (deve ser .../v3) e a chave da conta.'
    );
  }
  let out = mergePixFromRaw(p, raw);
  assertCreatedPaymentMatchesPayload(out, payload);
  return out;
}

function paymentHasPayHints(p: AsaasPayment): boolean {
  return Boolean(
    p.invoiceUrl ||
    p.bankSlipUrl ||
    p.pixTransaction?.payload ||
    p.pixTransaction?.qrCode
  );
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
  const raw = await request<PaymentCreateRaw>('POST', 'payments', payload);
  logAsaasJson('POST /payments — corpo bruto (checar invoiceUrl, bankSlipUrl, pixTransaction, snake_case, lista)', raw);
  let p = await resolvePaymentAfterPost(raw, payload);
  logAsaasJson('POST /payments — após resolvePaymentAfterPost', p);
  const id = p.id;
  if (id && !paymentHasPayHints(p)) {
    try {
      const fresh = await getPayment(id);
      logAsaasJson(`GET /payments/${id} — enriquecimento após POST sem links`, fresh);
      p = {
        ...p,
        ...fresh,
        pixTransaction: fresh.pixTransaction ?? p.pixTransaction,
      };
    } catch (e) {
      console.warn('[asaas] getPayment after create:', e instanceof Error ? e.message : e);
    }
  }
  logAsaasJson('createPayment — objeto final usado pelo servidor', p);
  return p;
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
      logAsaasJson(`GET /payments/${asaasPaymentId}/pixQrCode — chaves do payload PIX`, qr);
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

/** DELETE subscriptions/:id — cancela assinatura e remove parcelas pendentes no Asaas. */
export async function deleteAsaasSubscription(subscriptionId: string): Promise<void> {
  const base = getBaseUrl();
  const url = `${base.replace(/\/$/, '')}/subscriptions/${encodeURIComponent(subscriptionId)}`;
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
  return paymentsUnavailableReason() == null;
}

/** Motivo quando pagamentos estão desligados (null = ok). */
export function paymentsUnavailableReason(): string | null {
  const k = getAsaasApiKey().trim();
  if (!k) return 'ASAAS_API_KEY não configurada no backend (.env)';
  return null;
}

export interface AsaasSubscription {
  id?: string;
  customer?: string;
  value?: number;
  cycle?: string;
  billingType?: string;
  status?: string;
  nextDueDate?: string;
  description?: string;
  externalReference?: string;
}

/** GET /subscriptions/:id — confirma assinatura recorrente no Asaas. */
export async function getSubscription(subscriptionId: string): Promise<AsaasSubscription> {
  return request<AsaasSubscription>('GET', `subscriptions/${encodeURIComponent(subscriptionId)}`);
}

/** POST /subscriptions — assinatura recorrente (mensal). */
export async function createSubscription(payload: {
  customer: string;
  billingType: 'PIX' | 'BOLETO' | 'CREDIT_CARD';
  value: number;
  nextDueDate: string;
  cycle: 'MONTHLY' | 'WEEKLY' | 'BIWEEKLY' | 'QUARTERLY' | 'SEMIANNUALLY' | 'YEARLY';
  description?: string;
  externalReference?: string;
  creditCard?: {
    holderName: string;
    number: string;
    expiryMonth: string;
    expiryYear: string;
    ccv: string;
  };
  creditCardHolderInfo?: {
    name: string;
    email: string;
    cpfCnpj: string;
    /** Quando omitido no payload, o backend usa CEP genérico para o Asaas aceitar a assinatura. */
    postalCode?: string;
    addressNumber?: string;
    phone?: string;
    mobilePhone?: string;
  };
}): Promise<AsaasSubscription> {
  const raw = await request<AsaasSubscription & { data?: AsaasSubscription[] }>('POST', 'subscriptions', payload);
  logAsaasJson('POST /subscriptions — corpo bruto', raw);
  if (raw?.id) return raw;
  const list = raw?.data;
  if (Array.isArray(list) && list.length > 0) {
    const ext = payload.externalReference;
    if (ext) {
      const hit = list.find((s) => s.externalReference === ext && s.id);
      if (hit) return hit;
    }
    const first = list.find((s) => s.id);
    if (first) return first;
  }
  return raw;
}

/** GET /subscriptions/:id/payments — cobranças geradas pela assinatura. */
export async function getSubscriptionPayments(
  subscriptionId: string
): Promise<{ data?: AsaasPayment[] }> {
  return request<{ data?: AsaasPayment[] }>(
    'GET',
    `subscriptions/${encodeURIComponent(subscriptionId)}/payments`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** A primeira cobrança da assinatura pode demorar alguns instantes após o POST. */
export async function waitForSubscriptionFirstPayment(
  subscriptionId: string,
  maxAttempts = 10
): Promise<AsaasPayment | null> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await getSubscriptionPayments(subscriptionId);
      const rows = res?.data ?? [];
      const hit = rows.find((p) => p.id);
      if (hit) return hit;
    } catch (e) {
      console.warn('[asaas] getSubscriptionPayments:', e instanceof Error ? e.message : e);
    }
    if (i < maxAttempts - 1) await sleep(400);
  }
  return null;
}
