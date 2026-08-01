import {
  forwardRef,
  type InputHTMLAttributes,
} from "react";

interface RequiredTextInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "aria-describedby" | "aria-invalid" | "id" | "required"
> {
  id: string;
  label: string;
  error: string;
}

export const RequiredTextInput = forwardRef<HTMLInputElement, RequiredTextInputProps>(
  function RequiredTextInput({ id, label, error, className, ...inputProps }, ref) {
    const errorId = `${id}-error`;
    return (
      <div className={`required-field${error ? " has-error" : ""}`}>
        <label htmlFor={id}>
          <span>{label}</span>
          <small>REQUIRED</small>
        </label>
        <input
          {...inputProps}
          ref={ref}
          id={id}
          className={className}
          required
          aria-invalid={error ? "true" : "false"}
          aria-describedby={error ? errorId : undefined}
          aria-errormessage={error ? errorId : undefined}
        />
        {error ? (
          <p className="field-error" id={errorId} role="alert">
            <b aria-hidden="true">!</b>
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    );
  },
);
