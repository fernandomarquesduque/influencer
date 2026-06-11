import { francAll } from 'franc';

const FRANC_ISO6393_TO_BCP47 = {
  eng: 'en', por: 'pt-br', spa: 'es', fra: 'fr', deu: 'de', ita: 'it',
};
const MARGIN = 0.1;

function resolve(ranked) {
  const top = ranked[0][0];
  const topScore = ranked[0][1];
  if (top === 'por') return 'pt-br';
  if (top === 'eng') {
    const por = ranked.find((x) => x[0] === 'por')?.[1] ?? 0;
    return por > topScore - MARGIN ? 'pt-br' : 'en';
  }
  const m = FRANC_ISO6393_TO_BCP47[top];
  if (m) return m;
  for (let i = 1; i < ranked.length; i++) {
    const [code, score] = ranked[i];
    if (score < 0.65) continue;
    if (code === 'eng') return 'en';
    if (FRANC_ISO6393_TO_BCP47[code]) return FRANC_ISO6393_TO_BCP47[code];
  }
  return 'pt-br (fallback)';
}

const profiles = [
  { name: 'leonsbagelsnyc', text: "Leon's Bagels Nothing Fancy sandwiches spreads coffee SoHo Nolita Williamsburg FiDi In the line", handle: 'leonsbagelsnyc' },
  { name: 'liberta', text: "Liberta L'informazione di Piacenza e provincia dal 1883 In edicola su liberta.it e on demand su teleliberta.tv", handle: 'liberta_piacenza' },
  { name: 'leona', text: "Leona Lingerie La confianza en ti misma es la mejor pieza que puedes usar 35 tiendas a nivel nacional Contactanos", handle: 'leonalingerie.ve' },
];

for (const p of profiles) {
  const ranked = francAll(p.text, { minLength: 8 });
  console.log(p.name, 'top=', ranked[0], '=>', resolve(ranked));
}
