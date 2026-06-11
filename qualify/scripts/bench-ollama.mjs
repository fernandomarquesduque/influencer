import './load-qualify-env.mjs';
import { Ollama } from 'ollama';

const model = process.env.OLLAMA_MODEL?.trim() || 'llama3.1:8b';
const o = new Ollama({ host: process.env.OLLAMA_HOST?.trim() || 'http://localhost:11434' });

const prompt =
  'Retorne JSON: profileType, mainCategory, gender, subCategories, contentPillars, audienceType, brandSafety, personaSummary. Perfil @beleza_test, bio: Maquiadora profissional, dicas de skincare e rotina de beleza.';

for (let i = 1; i <= 2; i++) {
  const t0 = Date.now();
  const r = await o.chat({
    model,
    messages: [
      { role: 'system', content: 'Responda somente JSON valido em pt-BR.' },
      { role: 'user', content: prompt },
    ],
    stream: false,
  });
  const ms = Date.now() - t0;
  console.log(`ollama chat #${i}: ${ms}ms | ${(r.message?.content ?? '').slice(0, 80)}...`);
}
