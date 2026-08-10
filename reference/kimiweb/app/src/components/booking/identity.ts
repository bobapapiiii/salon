import { useEffect } from 'react'
import { create } from 'zustand'
import { trpc } from '@/providers/trpc'
import { phoneDigits } from './utils'

const CLIENT_KEY = 'lumina.clientId'
const SIGNED_OUT_KEY = 'lumina.signedOut'

interface IdentityState {
  clientId: number | null
  signedOut: boolean
  setClient: (id: number) => void
  signOut: () => void
}

export const useIdentityStore = create<IdentityState>()((set) => ({
  clientId: (() => {
    const v = localStorage.getItem(CLIENT_KEY)
    return v ? Number(v) : null
  })(),
  signedOut: localStorage.getItem(SIGNED_OUT_KEY) === '1',
  setClient: (id) => {
    localStorage.setItem(CLIENT_KEY, String(id))
    localStorage.removeItem(SIGNED_OUT_KEY)
    set({ clientId: id, signedOut: false })
  },
  signOut: () => {
    localStorage.removeItem(CLIENT_KEY)
    localStorage.setItem(SIGNED_OUT_KEY, '1')
    set({ clientId: null, signedOut: true })
  },
}))

/**
 * Demo identity (no auth in this phase): resolve "Hannah Lee" once and keep
 * her id in localStorage. All client-side pages read from this store.
 */
export function useDemoIdentity() {
  const { clientId, signedOut, setClient } = useIdentityStore()
  const salon = trpc.salon.get.useQuery()
  const salonId = salon.data?.id

  const lookup = trpc.clients.list.useQuery(
    { salonId: salonId ?? 0, search: 'hannah' },
    { enabled: !!salonId && clientId == null && !signedOut },
  )

  useEffect(() => {
    if (clientId == null && !signedOut && lookup.data && lookup.data.length > 0) {
      setClient(lookup.data[0]!.id)
    }
  }, [clientId, signedOut, lookup.data, setClient])

  const client = trpc.clients.get.useQuery(
    { id: clientId ?? 0 },
    { enabled: clientId != null },
  )

  return {
    salonId,
    salon: salon.data,
    clientId,
    client: client.data ?? null,
    isLoading: salon.isLoading || (clientId == null && !signedOut && lookup.isLoading) || (clientId != null && client.isLoading),
    signedOut,
    setClient,
    signOut: useIdentityStore((s) => s.signOut),
  }
}

/** Find a seeded client by phone (digit-normalized). Tries server search first. */
export async function findClientByPhone(
  utils: ReturnType<typeof trpc.useUtils>,
  salonId: number,
  phone: string,
) {
  const digits = phoneDigits(phone)
  if (digits.length < 7) return null
  const matches = (list: Awaited<ReturnType<typeof utils.clients.list.fetch>>) =>
    list.find((c) => phoneDigits(c.phone) === digits) ?? null
  // Server search honors the formatted string…
  const searched = await utils.clients.list.fetch({ salonId, search: phone })
  const hit = matches(searched)
  if (hit) return hit
  // …fall back to a full scan with digit comparison (formats may differ).
  const all = await utils.clients.list.fetch({ salonId })
  return matches(all)
}
