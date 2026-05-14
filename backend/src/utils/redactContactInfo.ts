/** Trecho de handle Instagram para regex (1–30 caracteres, evita casar e-mail). */
const IG_MENTION_HANDLE_BODY = '[a-zA-Z0-9](?:[a-zA-Z0-9._]{0,28}[a-zA-Z0-9])?';

/** @menção de rede social (não captura `usuario@dominio.com`). */
const MENTION_IN_TEXT_RE = new RegExp(`(^|[^a-zA-Z0-9._])@(${IG_MENTION_HANDLE_BODY})`, 'gi');

/** Candidatos a telefone (BR e formatos comuns com separadores). */
const PHONE_CANDIDATE_RE = /(?:\+?\s*(?:55\s*)?)?(?:\(?\s*\d{2}\s*\)?[\s.-]?)?(?:9[\s.-]?)?\d{4}[\s.-]?\d{4}/g;

export const CONTACT_REDACT_PLACEHOLDER = '[ocultado]';

function isLikelyPhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return false;
  return true;
}

/** Substitui @handles e telefones em texto livre por `[ocultado]`. */
export function redactContactInfoInText(text: string): string {
  if (!text || typeof text !== 'string') return text;
  let out = text.replace(MENTION_IN_TEXT_RE, (_match, prefix: string) => `${prefix}${CONTACT_REDACT_PLACEHOLDER}`);
  out = out.replace(PHONE_CANDIDATE_RE, (match) => (isLikelyPhone(match) ? CONTACT_REDACT_PLACEHOLDER : match));
  return out;
}

function redactOptionalText(value: unknown): unknown {
  return typeof value === 'string' ? redactContactInfoInText(value) : value;
}

function redactCaptionObject(cap: Record<string, unknown>): Record<string, unknown> {
  const out = { ...cap };
  out.text = redactOptionalText(out.text);
  return out;
}

/** Oculta @ e telefones nos campos de texto de um item do bucket `post`. */
export function redactContactInfoInPostItem(item: Record<string, unknown>): Record<string, unknown> {
  const out = { ...item };

  if (out.content && typeof out.content === 'object' && !Array.isArray(out.content)) {
    const content = { ...(out.content as Record<string, unknown>) };
    content.caption_text = redactOptionalText(content.caption_text);
    content.accessibility_caption = redactOptionalText(content.accessibility_caption);
    if (content.audio && typeof content.audio === 'object' && !Array.isArray(content.audio)) {
      const audio = { ...(content.audio as Record<string, unknown>) };
      audio.ig_artist_username = redactOptionalText(audio.ig_artist_username);
      content.audio = audio;
    }
    out.content = content;
  }

  if (out.post && typeof out.post === 'object' && !Array.isArray(out.post)) {
    const post = { ...(out.post as Record<string, unknown>) };
    if (post.caption && typeof post.caption === 'object' && !Array.isArray(post.caption)) {
      post.caption = redactCaptionObject(post.caption as Record<string, unknown>);
    }
    out.post = post;
  }

  if (out.caption && typeof out.caption === 'object' && !Array.isArray(out.caption)) {
    out.caption = redactCaptionObject(out.caption as Record<string, unknown>);
  }

  if (typeof out.caption_text === 'string') {
    out.caption_text = redactContactInfoInText(out.caption_text);
  }

  const edgeCaption = out.edge_media_to_caption;
  if (edgeCaption && typeof edgeCaption === 'object' && !Array.isArray(edgeCaption)) {
    const edge = { ...(edgeCaption as Record<string, unknown>) };
    const edges = edge.edges;
    if (Array.isArray(edges)) {
      edge.edges = edges.map((node) => {
        if (node == null || typeof node !== 'object') return node;
        const n = { ...(node as Record<string, unknown>) };
        const inner = n.node;
        if (inner != null && typeof inner === 'object' && !Array.isArray(inner)) {
          const innerNode = { ...(inner as Record<string, unknown>) };
          innerNode.text = redactOptionalText(innerNode.text);
          n.node = innerNode;
        }
        return n;
      });
    }
    out.edge_media_to_caption = edge;
  }

  return out;
}

export function redactContactInfoInPostItems<T extends Record<string, unknown>>(items: T[]): T[] {
  return items.map((item) => redactContactInfoInPostItem(item) as T);
}

function redactContactInfoInLlm(llm: Record<string, unknown>): Record<string, unknown> {
  const out = { ...llm };
  const qualification = out.qualification;
  if (qualification != null && typeof qualification === 'object' && !Array.isArray(qualification)) {
    const q = { ...(qualification as Record<string, unknown>) };
    q.personaSummary = redactOptionalText(q.personaSummary);
    out.qualification = q;
  }
  return out;
}

/** Oculta @ e telefones em biografia, LLM e campos textuais do perfil. */
export function redactContactInfoInProfile(profile: Record<string, unknown>): Record<string, unknown> {
  const out = { ...profile };

  if (typeof out.biography === 'string') {
    out.biography = redactContactInfoInText(out.biography);
  }

  if (out.data != null && typeof out.data === 'object' && !Array.isArray(out.data)) {
    const data = { ...(out.data as Record<string, unknown>) };
    const user = data.user;
    if (user != null && typeof user === 'object' && !Array.isArray(user)) {
      const u = { ...(user as Record<string, unknown>) };
      if (typeof u.biography === 'string') {
        u.biography = redactContactInfoInText(u.biography);
      }
      data.user = u;
    }
    out.data = data;
  }

  if (out.llm != null && typeof out.llm === 'object' && !Array.isArray(out.llm)) {
    out.llm = redactContactInfoInLlm(out.llm as Record<string, unknown>);
  }

  return out;
}

/** Oculta contatos na ativação (whatsapp etc.) e em descrições textuais. */
export function redactContactInfoInActivation(data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data };
  for (const key of ['whatsapp', 'phone', 'telefone']) {
    const v = out[key];
    if (typeof v === 'string' && v.trim()) {
      out[key] = CONTACT_REDACT_PLACEHOLDER;
    }
  }
  for (const key of ['description', 'about_topics', 'brands_worked_with', 'address', 'address_number']) {
    if (typeof out[key] === 'string') {
      out[key] = redactContactInfoInText(out[key] as string);
    }
  }
  return out;
}

/** Item de listagem/busca: perfil + ativação embutida. */
export function redactContactInfoInProfileListItem<T extends Record<string, unknown>>(item: T): T {
  let out = redactContactInfoInProfile(item) as T;
  const activation = out.activation;
  if (activation != null && typeof activation === 'object' && !Array.isArray(activation)) {
    out = {
      ...out,
      activation: redactContactInfoInActivation(activation as Record<string, unknown>),
    };
  }
  return out;
}
