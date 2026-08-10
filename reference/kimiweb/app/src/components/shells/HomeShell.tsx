import { Outlet } from 'react-router-dom'
import Layout from '@/components/Layout'

/**
 * HomeShell — route `/` (design.md §7.1).
 * Transparent-to-solid top nav + footer come from the shared home `Layout`;
 * content slot is <Outlet/> (nested route pattern B — never children).
 */
export default function HomeShell() {
  return (
    <Layout>
      <Outlet />
    </Layout>
  )
}
