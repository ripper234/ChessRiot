interface MagicCompileStatusProps {
  state: "idle" | "thinking" | "success" | "failure";
  labels?: string[];
  message?: string;
}

export function MagicCompileStatus({
  state,
  labels = [],
  message = "",
}: MagicCompileStatusProps) {
  if (state === "thinking") {
    return (
      <div className="magic-compile-status thinking" role="status">
        <i className="magic-thinking-spinner" aria-hidden="true" />
        <span>THINKING…</span>
      </div>
    );
  }
  if (state === "success") {
    return (
      <div className="magic-compile-status success" role="status">
        <b aria-hidden="true">✓</b>
        <span>COMPILED</span>
        <p>{labels.join(" · ")}</p>
      </div>
    );
  }
  if (state === "failure") {
    return (
      <div className="magic-compile-status failure" role="alert">
        <b aria-hidden="true">×</b>
        <span>FAILED</span>
        <p>{message}</p>
      </div>
    );
  }
  return (
    <small>
      Describe a rule in your own words or language, then compile it.
    </small>
  );
}
