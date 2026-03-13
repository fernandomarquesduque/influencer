# Módulo de pagamento Asaas

Documentação e requisitos do módulo de integração com a API **Asaas v3** para pagamentos, assinaturas e transferências. O módulo deve funcionar em **sandbox no localhost** e em **produção** com configuração clara por ambiente.

---

## 1. Configuração de ambiente

### Base URL

- **Sandbox:** `https://sandbox.asaas.com/api/v3/` (ou `https://api-sandbox.asaas.com/v3`)
- **Produção:** `https://api.asaas.com/v3/`

A base pode ser escolhida por “place” (ex.: sualoja, 423423 = sandbox) conforme sua conta.

### Autenticação

- **Header:** `access_token` com o valor da chave API (não usar `Authorization: Bearer`).
- Todas as requisições devem enviar: `access_token: <ASAAS_API_KEY>`.

### Variáveis de ambiente

| Variável       | Descrição                                      |
|----------------|------------------------------------------------|
| `ASAAS_ENV`    | `sandbox` ou `production`                      |
| `ASAAS_API_KEY`| Chave API (sandbox em dev, produção em prod)  |

- Em **localhost:** usar sempre `ASAAS_ENV=sandbox` e token de sandbox.
- Em **produção:** `ASAAS_ENV=production` e token de produção.
- Tokens de sandbox e produção são diferentes; não commitar chaves. Usar `.env` e `.env.example` com `ASAAS_ENV` e `ASAAS_API_KEY`.

---

## 2. Endpoints utilizados

| Recurso              | Método | Caminho (ex.)                    | Uso                              |
|----------------------|--------|----------------------------------|----------------------------------|
| Conta                | GET    | `myAccount`                      | Status da conta                  |
| Saldo                | GET    | `finance/getCurrentBalance`      | Saldo atual                      |
| Clientes             | GET    | `customers?cpfCnpj={doc}`        | Buscar por CPF/CNPJ              |
| Clientes             | POST   | `customers`                      | Criar cliente                    |
| Cobranças            | GET    | `payments?offset={n}`            | Listar pagamentos                |
| Cobrança             | GET    | `payments/{id}`                  | Detalhe de um pagamento          |
| Cobranças (assinatura)| GET   | `payments?subscription={id}`     | Pagamentos da assinatura        |
| Cobrança             | POST   | `payments`                       | Criar cobrança (cartão/boleto)   |
| Estorno              | POST   | `payments/{id}/refund`           | Estornar pagamento               |
| Deletar cobrança     | DELETE | `payments/{id}`                  | Remover cobrança                 |
| Assinaturas          | GET    | `subscriptions?description={desc}` | Listar por descrição          |
| Assinatura           | GET    | `subscriptions/{id}`            | Detalhe da assinatura            |
| Assinatura           | POST   | `subscriptions`                 | Criar assinatura                 |
| Assinatura           | POST   | `subscriptions/{id}`            | Atualizar assinatura (ex.: valor)|
| Transferências       | GET    | `transfers`                     | Listar transferências            |
| Transferência        | POST   | `transfers`                     | Criar transferência (TED)        |
| Conta (excluir)      | DELETE | `myAccount?removeReason=...`    | Excluir subconta                 |
| Subcontas            | POST   | `accounts`                      | Criar subconta (vendedor)        |
| Contas bancárias     | GET    | `bankAccounts`                  | Listar contas bancárias          |
| Conta principal      | POST   | `bankAccounts/mainAccount`      | Definir conta principal          |
| Documentos           | POST   | `documents` (v2, multipart)     | Enviar documento                 |
| Cidades              | GET    | `cities?limit=1000`             | Listar cidades                   |

Documentação oficial: [https://docs.asaas.com/](https://docs.asaas.com/)

---

## 3. Status de pagamento

Mapeamento usado no código para exibição/tratamento:

| Status Asaas           | Descrição (ex.)        |
|------------------------|------------------------|
| `PENDING`              | Pendente               |
| `PENDENTE`             | Pendente               |
| `OVERDUE`              | Vencido                |
| `CONFIRMED`            | Confirmado             |
| `RECEIVED`             | Recebido               |
| `CAPTURED`             | Capturado              |
| `DONE`                 | Concluído              |
| `REFUNDED`             | Estornado              |
| `REFUND_REQUESTED`     | Estorno solicitado     |
| `CHARGEBACK_*`         | Chargeback             |
| `DUNNING_*`            | Cobrança/recuperação   |
| `AWAITING_RISK_ANALYSIS` | Em análise de risco  |
| `FAILED`               | Falhou                 |
| `BANK_PROCESSING`      | Processando no banco   |
| `RECEIVED_IN_CASH`     | Recebido em dinheiro   |

Recomenda-se um enum ou objeto no código com rótulos em português para a UI.

---

## 4. Fluxos principais

### 4.1 Cliente (customers)

1. **Buscar:** `GET customers?cpfCnpj={doc}`.
2. **Se não existir:** `POST customers` com:
   - `name`, `email`, `phone`, `cpfCnpj`, `address`, `addressNumber`, `province`, `city`, `state`, `postalCode`, `birthdate`, `externalReference`, `groupName`.

### 4.2 Cobrança com cartão

- **POST** `payments`:
  - `customer`, `value`, `dueDate`
  - `billingType`: `CREDIT_CARD` ou `DEBIT_CARD`
  - `creditCard`: `holderName`, `number`, `expiryMonth`, `expiryYear`, `ccv`
  - `creditCardHolderInfo`: `name`, `email`, `cpfCnpj`, `birthdate`, `address`, `postalCode`, etc.
  - `description`, `externalReference`, `remoteIp`

### 4.3 Cobrança com boleto

- Na API v3 Asaas: `payments` com `billingType: BOLETO`.
- Payload: `customer`, `value`, `dueDate`, `billingType: BOLETO`, `description`, `externalReference` (e campos específicos de boleto se necessário).

### 4.4 Assinatura

- **POST** `subscriptions`:
  - `customer`, `value`, `cycle` (ex.: `MONTHLY`), `nextDueDate`
  - `creditCard` + `creditCardHolderInfo`
  - `billingType`, `description`, `externalReference`, `remoteIp`
- **Atualizar:** POST/PATCH `subscriptions/{id}` (ex.: alterar `value` e `updatePendingPayments`).

### 4.5 Transferência (TED)

- **POST** `transfers`:
  - `value`
  - `bankAccount`: `ownerName`, `bank.code`, `cpfCnpj`, `agency`, `account`, `accountDigit`, `bankAccountType` (`CONTA_CORRENTE` / `CONTA_POUPANCA`)
  - `operationType`: `TED`

---

## 5. Tratamento de erros

- A API retorna erros em um **array `errors`**.
- Exemplo de mensagem legível: `errors[0].description`.
- O módulo deve expor erros de forma padronizada: código HTTP, lista de erros Asaas e mensagem amigável.

---

## 6. Requisitos do módulo Node (TypeScript/JavaScript)

### 6.1 Cliente HTTP

- Cliente centralizado (axios ou fetch) com:
  - Base URL e header `access_token` definidos por ambiente.
  - Tratamento de erros (array `errors` → mensagem legível).

### 6.2 Funcionalidades obrigatórias

1. **Conta e financeiro**
   - GET `myAccount` — conta atual.
   - GET `finance/getCurrentBalance` — saldo atual.

2. **Clientes**
   - GET `customers` (query params, ex.: `cpfCnpj`).
   - POST `customers` (campos listados em 4.1).

3. **Cobranças**
   - POST `payments` (cartão e boleto conforme 4.2 e 4.3).
   - GET `payments/{id}`, GET `payments` (offset, limit, filtros).
   - GET `payments?subscription={id}`.
   - POST `payments/{id}/refund`, DELETE `payments/{id}`.

4. **Assinaturas**
   - POST `subscriptions`, GET `subscriptions/{id}`, GET `subscriptions` (filtros).
   - Atualizar: POST/PATCH `subscriptions/{id}`.

5. **Transferências**
   - GET `transfers`, POST `transfers` (TED conforme 4.5).

6. **Contas bancárias (subconta/split)**
   - GET `bankAccounts`.
   - POST `bankAccounts/mainAccount` (campos conforme documentação).

7. **Outros**
   - DELETE `myAccount?removeReason=...` quando aplicável.
   - Mapeamento de status de pagamento (enum/objeto com rótulos em PT).

### 6.3 Boas práticas

- TypeScript com tipos/interfaces para payloads e respostas (Customer, Payment, Subscription, Transfer, etc.).
- Não commitar chaves; `.env` e `.env.example` com `ASAAS_ENV` e `ASAAS_API_KEY`.
- Opcional: em localhost validar/forçar `ASAAS_ENV=sandbox` e recusar token de produção.
- README do projeto: explicar como rodar em sandbox (localhost) e como configurar produção (token + `ASAAS_ENV=production`).

---

## 7. Como rodar

### Sandbox (localhost)

1. Definir no `.env`:
   - `ASAAS_ENV=sandbox`
   - `ASAAS_API_KEY=<sua_chave_sandbox>`
2. Usar base URL de sandbox e token de sandbox em todas as chamadas.

### Produção

1. Definir no `.env` (ou variáveis do servidor):
   - `ASAAS_ENV=production`
   - `ASAAS_API_KEY=<sua_chave_producao>`
2. Garantir que o deploy use apenas essas variáveis de produção e nunca token de sandbox em produção.

---

## 8. Exemplo `.env.example`

```env
# Asaas: sandbox (localhost) ou production (deploy)
ASAAS_ENV=sandbox
ASAAS_API_KEY=
```

Preencher `ASAAS_API_KEY` com a chave do ambiente correspondente e não commitar o `.env`.
