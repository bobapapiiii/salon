import { useMemo } from 'react'
import { trpc } from '@/providers/trpc'

/** Salon + service catalog + staff, with handy lookup maps. */
export function useCatalog() {
  const salon = trpc.salon.get.useQuery()
  const salonId = salon.data?.id
  const servicesQ = trpc.services.list.useQuery(
    { salonId: salonId ?? 0 },
    { enabled: salonId != null },
  )
  const staffQ = trpc.staff.list.useQuery(
    { salonId: salonId ?? 0 },
    { enabled: salonId != null },
  )

  const derived = useMemo(() => {
    const categories = (servicesQ.data ?? []).map((c) => ({
      ...c,
      services: c.services.filter((s) => s.onlineBookable && s.active),
    }))
    const serviceById = new Map<number, ServiceRow>()
    const categoryOfService = new Map<number, CategoryRow>()
    for (const c of categories) {
      for (const s of c.services) {
        serviceById.set(s.id, s)
        categoryOfService.set(s.id, c)
      }
    }
    const staff = staffQ.data ?? []
    const staffById = new Map(staff.map((s) => [s.id, s]))
    return { categories, serviceById, categoryOfService, staff, staffById }
  }, [servicesQ.data, staffQ.data])

  return {
    salon: salon.data,
    salonId,
    ...derived,
    isLoading: salon.isLoading || servicesQ.isLoading || staffQ.isLoading,
  }
}

import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '../../../api/router'

type RouterOutputs = inferRouterOutputs<AppRouter>
export type CategoryRow = RouterOutputs['services']['list'][number]
export type ServiceRow = CategoryRow['services'][number]
export type StaffRow = RouterOutputs['staff']['list'][number]
export type Slot = RouterOutputs['availability']['slots'][number]
export type ClientRow = RouterOutputs['clients']['get']
export type ClientAppt = RouterOutputs['appointments']['forClient'][number]
export type ClientRequest = RouterOutputs['requests']['forClient'][number]

/** Techs qualified for ALL given services (checks service.staffIds). */
export function qualifiedForAll(staff: StaffRow[], serviceIds: number[]): StaffRow[] {
  return staff.filter((t) => t.active && serviceIds.every((id) => t.serviceIds.includes(id)))
}

/** Techs qualified for one service. */
export function qualifiedForService(staff: StaffRow[], serviceId: number): StaffRow[] {
  return staff.filter((t) => t.active && t.serviceIds.includes(serviceId))
}
