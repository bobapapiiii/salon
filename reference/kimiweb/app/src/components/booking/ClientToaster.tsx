import { Toaster } from 'sonner'

/**
 * Client-side themed toast (design.md §7.2): night bg, white text, r-md,
 * bottom above the tab bar; mutation toasts carry a clay Undo action.
 * Rendered once per client page (only one page is mounted at a time).
 */
export default function ClientToaster() {
  return (
    <Toaster
      position="bottom-center"
      gap={8}
      toastOptions={{
        style: {
          background: '#241C15',
          color: '#FFFEFB',
          border: '1px solid rgba(250,246,239,.14)',
          borderRadius: '10px',
          fontFamily: 'Manrope, ui-sans-serif, system-ui, sans-serif',
        },
        classNames: {
          actionButton: '!bg-transparent !text-[#F6E3D6] !font-bold underline underline-offset-2',
          cancelButton: '!bg-transparent !text-[#A3937F]',
        },
      }}
      style={{ bottom: '76px' }}
    />
  )
}
