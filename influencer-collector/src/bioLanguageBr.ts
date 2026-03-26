/**
 * Valida se a bio parece português brasileiro (franc + heurísticas pt-BR vs pt-PT).
 */

import { franc } from 'franc';
import { collectBioRawText, explainRejectedEstablishmentKeywordInBio } from './entityRules.js';

function pickBio(entity: Record<string, unknown>): string {
  return collectBioRawText(entity);
}

/**
 * Mínimo de caracteres úteis (após prepBio: sem URLs e @) para rodar franc/heurísticas.
 * Abaixo disso a bio é aceita como pt-BR válida — texto curto demais para idioma confiável.
 * Override: COLLECTOR_BIO_PT_BR_MIN_USEFUL_CHARS (0 = sempre analisar idioma).
 */
function minCharsStrict(): number {
  const raw = process.env.COLLECTOR_BIO_PT_BR_MIN_USEFUL_CHARS?.trim();
  if (raw === undefined || raw === '') return 22;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 22;
}

function prepBio(s: string): string {
  return s
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/www\.\S+/gi, ' ')
    .replace(/@\w[\w.]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const LABEL: Record<string, string> = {
  eng: 'inglês',
  spa: 'espanhol',
  fra: 'francês',
  deu: 'alemão',
  ita: 'italiano',
  nld: 'holandês',
  rus: 'russo',
  jpn: 'japonês',
  kor: 'coreano',
  zho: 'chinês',
  arb: 'árabe',
  hin: 'hindi',
  glg: 'galego',
};

function looksEuropeanPt(text: string): boolean {
  const t = text.toLowerCase();
  if (/\b(portugal|lisboa|coimbra|braga|funchal)\b/.test(t)) return true;
  if (/\bporto\b/.test(t) && /\bportugal\b/.test(t)) return true;
  if (/\+351\b/.test(t)) return true;
  if (
    /\b(telemóvel|telemovel)\b/.test(t) &&
    !/\b(brasil|brazil|são paulo|sao paulo|rio de janeiro)\b/.test(t)
  )
    return true;
  return false;
}

function looksBrazilianPt(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\u0300-\u036f/g, '');
  if (/\b(brasil|brazil)\b/.test(t)) return true;
  if (/\.com\.br\b|mercadolivre|shopee|hotmart|kiwify|ame digital/i.test(text)) return true;
  if (/\b(pix|picpay)\b/.test(t)) return true;
  if (
    /\b(sao paulo|são paulo|rio de janeiro|belo horizonte|brasilia|curitiba|recife|salvador|fortaleza|manaus|goiania|belém|porto alegre)\b/.test(
      t
    )
  )
    return true;
  if (/\b(vc\b|tbm\b|\bpq\b|\bpra\b|\bpro\b|\bne\b|\bto\b|\bta\b|mano\b|miga\b|parceria\b)/.test(t))
    return true;
  if (/\brj\b|\bsp\b|\bmg\b|\bpr\b|\brs\b|\bba\b|\bce\b/.test(t) && t.length < 120) return true;
  return false;
}

/** Português genérico (pt-BR ou pt-PT) por palavras muito comuns. */
function looksLikePortuguese(text: string): boolean {
  const t = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\u0300-\u036f/g, '');
  return /\b(nao|não|voce|você|mais|muito|tambem|também|sobre|como|para|pelo|pela|aqui|todos|todas|sempre|vida|amor|bem|vou|fazer|feito|cliente|contato|email|link|clique)\b/.test(
    t
  );
}

/**
 * @returns mensagem de regra se deve rejeitar; `null` se aprovar neste critério.
 */
export function explainBioNotBrazilianPortuguese(entity: Record<string, unknown>): string | null {
  const bioLista = explainRejectedEstablishmentKeywordInBio(entity);
  if (bioLista) return bioLista;

  const text = prepBio(pickBio(entity));
  const minStrict = minCharsStrict();
  if (text.length < minStrict) return null;

  const code = franc(text);

  /* por = português; glg = galego — o franc confunde pt-BR com glg com frequência, tratamos os dois igual. */
  if (code === 'por' || code === 'glg' || code === 'vec' || code === 'ita' || code === 'src') {
    if (looksEuropeanPt(text) && !looksBrazilianPt(text)) {
      return 'Bio em português europeu (Portugal) — aceitamos apenas perfil com bio em português brasileiro.';
    }
    return null;
  }

  if (code === 'und') {
    if (looksBrazilianPt(text)) return null;
    if (looksLikePortuguese(text) && !looksEuropeanPt(text)) return null;
    if (text.length >= 55) {
      return 'Bio não identificada como português brasileiro (texto longo sem sinais de pt-BR).';
    }
    return null;
  }

  const human = LABEL[code] ?? `código ${code}`;
  return `Bio não está em português brasileiro (idioma provável: ${human}).`;
}
