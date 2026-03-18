/**
 * Teste de envio de e-mail de validação.
 * Uso: npx tsx src/scripts/test-email.ts <email>
 * Ex.: npx tsx src/scripts/test-email.ts marquesduque@hotmail.com
 */
import 'dotenv/config';
import { sendVerificationEmail } from '../email/sendVerificationEmail.js';

const email = process.argv[2]?.trim();
if (!email || !email.includes('@')) {
  console.error('Uso: npx tsx src/scripts/test-email.ts <email>');
  process.exit(1);
}

const frontBase = process.env.FRONTEND_BASE_URL || process.env.VITE_APP_URL || 'http://localhost:5173';
const verifyUrl = `${frontBase.replace(/\/$/, '')}/verify-email?token=test-token-${Date.now()}`;

console.log('Enviando e-mail de teste para:', email);
console.log('SMTP_HOST:', process.env.SMTP_HOST || '(não definido)');
console.log('SMTP_USER:', process.env.SMTP_USER ? '***' : '(não definido)');
console.log('---');

const result = await sendVerificationEmail({
  to: email,
  subject: '[Teste] Confirme seu e-mail - Busca Influencer',
  verifyUrl,
  bodyText: 'Este é um e-mail de teste. Clique no link abaixo para simular a validação (o token de teste não funcionará no app).',
});

console.log('---');
if (result.sent) {
  console.log('E-mail enviado com sucesso. Verifique a caixa de entrada e a pasta de spam.');
} else {
  console.log('E-mail NÃO foi enviado:', result.error || 'SMTP não configurado.');
}
