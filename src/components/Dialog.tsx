import { useEffect, useId, useRef, type ReactNode } from 'react'

interface DialogProps {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  className?: string
  /** Hide the visible heading (it stays available to screen readers). */
  hideTitle?: boolean
}

/**
 * Modal built on the native <dialog>: showModal() provides the focus trap, Escape handling,
 * inert background and top-layer rendering. Focus returns to the opener on close.
 */
export function Dialog({ title, onClose, children, className, hideTitle }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const opener = document.activeElement as HTMLElement | null
    dialog.showModal()
    // showModal() focuses the first focusable element (the close button); prefer the element the
    // content marked with data-autofocus (e.g. "Cancel" in a delete confirmation).
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    document.body.classList.add('modal-open')
    const handleCancel = (event: Event) => {
      event.preventDefault()
      onCloseRef.current()
    }
    dialog.addEventListener('cancel', handleCancel)
    return () => {
      dialog.removeEventListener('cancel', handleCancel)
      if (dialog.open) dialog.close()
      document.body.classList.remove('modal-open')
      opener?.focus?.()
    }
  }, [])

  return (
    <dialog
      ref={ref}
      className={`dialog ${className ?? ''}`}
      aria-labelledby={titleId}
      onClick={(event) => {
        // A click on the backdrop (outside the panel) closes the dialog.
        if (event.target === ref.current) onClose()
      }}
    >
      <div className="dialog__panel">
        <header className="dialog__header">
          <h2 id={titleId} className={hideTitle ? 'visually-hidden' : 'dialog__title'}>
            {title}
          </h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="סגירה">
            <span aria-hidden="true">×</span>
          </button>
        </header>
        {children}
      </div>
    </dialog>
  )
}
