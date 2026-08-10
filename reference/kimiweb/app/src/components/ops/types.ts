import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '../../../api/router'

/** Inferred backend row types (single source of truth: the tRPC router). */
export type RouterOutputs = inferRouterOutputs<AppRouter>

export type SalonRow = RouterOutputs['salon']['get']
export type StaffRow = RouterOutputs['staff']['list'][number]
export type CategoryWithServices = RouterOutputs['services']['list'][number]
export type ServiceRow = CategoryWithServices['services'][number]
export type ClientRow = RouterOutputs['clients']['list'][number]
export type ClientDetail = RouterOutputs['clients']['get']
export type RequestRow = RouterOutputs['requests']['list'][number]
export type Slot = RouterOutputs['availability']['slots'][number]
export type AppointmentRow = RouterOutputs['appointments']['forClient'][number]
