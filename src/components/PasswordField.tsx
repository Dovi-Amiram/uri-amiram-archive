import { forwardRef, useId } from 'react'

interface PasswordFieldProps {
  value: string
  error: string | null
  onChange: (value: string) => void
}

/** Shown in write dialogs until the browser tab has a valid session. */
export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(function PasswordField({ value, error, onChange }, ref) {
  const id = useId()
  return (
    <div className="field field--password">
      <label htmlFor={id}>סיסמת עריכה</label>
      <input
        id={id}
        ref={ref}
        type="password"
        autoComplete="current-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && (
        <p className="field__error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  )
})
