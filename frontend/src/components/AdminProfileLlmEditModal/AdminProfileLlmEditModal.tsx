import { useEffect, useState } from 'react'
import { Modal, Form, Input, Select, Typography, message } from 'antd'
import type { ProfileItem } from '../../api'
import { patchAdminInfluencerLlmQualification, type AdminInfluencerLlmQualificationPatch } from '../../api'

const { Text } = Typography

type LlmFormValues = {
  personaSummary: string
  profileType: string
  gender: string
  mainCategory: string
  language: string
  subCategories: string[]
  contentPillars: string[]
  audienceType: string[]
  toneOfVoice: string[]
  brandSafety: string
}

function strList(arr: unknown): string[] {
  if (!Array.isArray(arr)) return []
  const out: string[] = []
  for (const x of arr) {
    if (typeof x !== 'string') continue
    const t = x.trim()
    if (t) out.push(t)
  }
  return out
}

function profileToFormValues(profile: ProfileItem | null | undefined): LlmFormValues {
  const empty: LlmFormValues = {
    personaSummary: '',
    profileType: '',
    gender: '',
    mainCategory: '',
    language: '',
    subCategories: [],
    contentPillars: [],
    audienceType: [],
    toneOfVoice: [],
    brandSafety: '',
  }
  const rec = profile as Record<string, unknown> | null | undefined
  const llm = rec?.llm
  if (llm == null || typeof llm !== 'object' || Array.isArray(llm)) return empty
  const qRaw = (llm as Record<string, unknown>).qualification
  if (qRaw == null || typeof qRaw !== 'object' || Array.isArray(qRaw)) return empty
  const q = qRaw as Record<string, unknown>
  const bs = q.brandSafety
  let brandSafety = ''
  if (typeof bs === 'string') brandSafety = bs.trim()
  else if (bs != null && typeof bs === 'object' && !Array.isArray(bs)) {
    try {
      brandSafety = JSON.stringify(bs)
    } catch {
      brandSafety = ''
    }
  }
  return {
    personaSummary: String(q.personaSummary ?? '').trim(),
    profileType: String(q.profileType ?? '').trim(),
    gender: String(q.gender ?? '').trim(),
    mainCategory: String(q.mainCategory ?? '').trim(),
    language: String(q.language ?? '').trim(),
    subCategories: strList(q.subCategories),
    contentPillars: strList(q.contentPillars),
    audienceType: strList(q.audienceType),
    toneOfVoice: strList(q.toneOfVoice),
    brandSafety,
  }
}

type Props = {
  open: boolean
  handle: string
  profile: ProfileItem | null | undefined
  onClose: () => void
  onSaved: () => void | Promise<void>
}

export default function AdminProfileLlmEditModal({ open, handle, profile, onClose, onSaved }: Props) {
  const [form] = Form.useForm<LlmFormValues>()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    form.setFieldsValue(profileToFormValues(profile))
  }, [open, profile, form])

  const handleOk = async () => {
    try {
      const v = await form.validateFields()
      const payload: AdminInfluencerLlmQualificationPatch = {
        personaSummary: v.personaSummary ?? '',
        profileType: v.profileType ?? '',
        gender: v.gender ?? '',
        mainCategory: v.mainCategory ?? '',
        language: v.language ?? '',
        subCategories: v.subCategories ?? [],
        contentPillars: v.contentPillars ?? [],
        audienceType: v.audienceType ?? [],
        toneOfVoice: v.toneOfVoice ?? [],
      }
      const t = (v.brandSafety ?? '').trim()
      if (t) {
        if (t.startsWith('{')) {
          try {
            payload.brandSafety = JSON.parse(t) as Record<string, unknown>
          } catch {
            payload.brandSafety = t
          }
        } else {
          payload.brandSafety = t
        }
      }
      setSaving(true)
      await patchAdminInfluencerLlmQualification(handle, payload)
      message.success('Classificação LLM atualizada no RocksDB.')
      await onSaved()
      onClose()
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return
      message.error(e instanceof Error ? e.message : 'Falha ao salvar')
    } finally {
      setSaving(false)
    }
  }

  const tagSelectProps = {
    mode: 'tags' as const,
    tokenSeparators: [','] as string[],
    placeholder: 'Digite e Enter',
    style: { width: '100%' } as const,
  }

  return (
    <Modal
      title={`Editar LLM — @${handle.replace(/^@/, '')}`}
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={saving}
      okText="Salvar"
      cancelText="Cancelar"
      width={640}
      destroyOnHidden
    >
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        Altera <Text code>llm.qualification</Text> deste perfil na base. Campos vazios também são gravados onde aplicável.
      </Text>
      <Form form={form} layout="vertical">
        <Form.Item name="personaSummary" label="Resumo do perfil (personaSummary)">
          <Input.TextArea rows={4} placeholder="Descrição editorial do perfil" />
        </Form.Item>
        <Form.Item name="profileType" label="Tipo de perfil (profileType)">
          <Input placeholder="ex.: criador, empresa" />
        </Form.Item>
        <Form.Item name="gender" label="Gênero inferido (gender)">
          <Input placeholder="ex.: feminino" />
        </Form.Item>
        <Form.Item name="mainCategory" label="Categoria principal (mainCategory)">
          <Input placeholder="Categoria literal usada nos filtros" />
        </Form.Item>
        <Form.Item name="language" label="Idioma (language)">
          <Input placeholder="ex.: pt-br" />
        </Form.Item>
        <Form.Item name="subCategories" label="Subcategorias (subCategories)">
          <Select {...tagSelectProps} />
        </Form.Item>
        <Form.Item name="contentPillars" label="Pilares de conteúdo (contentPillars)">
          <Select {...tagSelectProps} />
        </Form.Item>
        <Form.Item name="audienceType" label="Público-alvo (audienceType)">
          <Select {...tagSelectProps} />
        </Form.Item>
        <Form.Item name="toneOfVoice" label="Tom de voz (toneOfVoice)">
          <Select {...tagSelectProps} />
        </Form.Item>
        <Form.Item
          name="brandSafety"
          label="Brand safety (brandSafety)"
          tooltip="Texto livre ou JSON de objeto, opcional"
        >
          <Input placeholder="Opcional" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
