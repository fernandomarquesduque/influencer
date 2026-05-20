# Busca Influencer

Plataforma para busca e análise de influenciadores no Instagram, com backend API, frontend web e coletor de dados.

## Estrutura

| Pasta | Descrição |
|-------|-----------|
| `backend/` | API Node.js (perfis, campanhas, busca) |
| `frontend/` | App React (Vite) |
| `influencer-collector/` | Coleta de dados do Instagram |
| `qualify/` | Qualificação de perfis via LLM |

## Pré-requisitos

- Node.js 20+
- npm

## Configuração rápida

1. Clone o repositório e instale dependências em cada pasta que for usar:

```bash
cd backend && npm install
cd ../frontend && npm install
cd ../influencer-collector && npm install
cd ../qualify && npm install
```

2. Copie os arquivos de exemplo de ambiente:

```bash
cp backend/.env.example backend/.env
cp influencer-collector/.env.example influencer-collector/.env
cp qualify/.env.example qualify/.env
```

3. Preencha as variáveis em cada `.env` (nunca commite arquivos `.env` reais).

## Desenvolvimento

```bash
# Backend
cd backend && npm run dev

# Frontend
cd frontend && npm run dev
```

Consulte os READMEs em `backend/`, `frontend/`, `influencer-collector/` e `qualify/` para detalhes específicos.

## Segurança

- Arquivos `.env`, `data/` e credenciais do coletor ficam fora do Git (ver `.gitignore`).
- Use sempre repositório **privado** se o projeto contiver lógica de negócio ou integrações sensíveis.
