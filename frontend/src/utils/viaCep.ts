/**
 * Resposta da API ViaCEP (https://viacep.com.br).
 * Em caso de CEP inválido, a API retorna { erro: true }.
 */
export interface ViaCepResponse {
  cep?: string
  logradouro?: string
  complemento?: string
  bairro?: string
  localidade?: string
  uf?: string
  ibge?: string
  gia?: string
  ddd?: string
  siafi?: string
  erro?: boolean
}

/**
 * Busca endereço pelo CEP (apenas dígitos, 8 caracteres).
 * Retorna undefined se CEP inválido ou não encontrado.
 */
export async function fetchAddressByCep(cep: string): Promise<ViaCepResponse | undefined> {
  const digits = cep.replace(/\D/g, '')
  if (digits.length !== 8) return undefined
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return undefined
    const data = (await res.json()) as ViaCepResponse
    if (data?.erro === true) return undefined
    return data
  } catch {
    return undefined
  }
}
