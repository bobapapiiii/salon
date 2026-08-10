import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'

import HomeShell from '@/components/shells/HomeShell'
import SalonShell from '@/components/shells/SalonShell'
import ClientShell from '@/components/shells/ClientShell'

import Home from '@/pages/Home'
import Schedule from '@/pages/salon/Schedule'
import Requests from '@/pages/salon/Requests'
import Services from '@/pages/salon/Services'
import Clients from '@/pages/salon/Clients'
import Book from '@/pages/book/Book'
import MyAppointments from '@/pages/book/MyAppointments'
import Account from '@/pages/book/Account'

/**
 * Nested-route (layout-route) pattern throughout — every shell renders
 * <Outlet/> and every page is a child <Route>. Never mix with children.
 * Home → app routes cross-fade 250ms (home.md page-level notes).
 */
function AnimatedRoutes() {
  const location = useLocation()
  const section = location.pathname.split('/')[1] || 'home'

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={section}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        <Routes location={location}>
          <Route element={<HomeShell />}>
            <Route index element={<Home />} />
          </Route>
          <Route element={<SalonShell />}>
            <Route path="/salon/schedule" element={<Schedule />} />
            <Route path="/salon/requests" element={<Requests />} />
            <Route path="/salon/services" element={<Services />} />
            <Route path="/salon/clients" element={<Clients />} />
          </Route>
          <Route element={<ClientShell />}>
            <Route path="/book" element={<Book />} />
            <Route path="/book/appointments" element={<MyAppointments />} />
            <Route path="/book/account" element={<Account />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AnimatedRoutes />
    </BrowserRouter>
  )
}
