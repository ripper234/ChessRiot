export type PushSetupStage =
  | "config"
  | "service_worker"
  | "subscription_read"
  | "subscription_replace"
  | "subscription_create"
  | "subscription_serialize"
  | "server_status"
  | "server_register";

export type PushSetupFailureKind =
  | "aborted"
  | "timeout"
  | "not_allowed"
  | "invalid_state"
  | "invalid_key"
  | "unsupported"
  | "network"
  | "security"
  | "unauthorized"
  | "account_changed"
  | "rate_limited"
  | "unavailable"
  | "invalid_response"
  | "unknown";

const DOM_ERROR_KINDS: Readonly<Record<string, PushSetupFailureKind>> = {
  AbortError: "aborted",
  TimeoutError: "timeout",
  NotAllowedError: "not_allowed",
  InvalidStateError: "invalid_state",
  InvalidAccessError: "invalid_key",
  InvalidCharacterError: "invalid_key",
  NotSupportedError: "unsupported",
  NetworkError: "network",
  SecurityError: "security",
};

export class PushSetupError extends Error {
  readonly stage: PushSetupStage;
  readonly kind: PushSetupFailureKind;

  constructor(stage: PushSetupStage, kind: PushSetupFailureKind) {
    super(`Push setup failed during ${stage}.`);
    this.name = "PushSetupError";
    this.stage = stage;
    this.kind = kind;
  }
}

function browserFailureKind(error: unknown): PushSetupFailureKind {
  if (!error || typeof error !== "object") return "unknown";
  const name = "name" in error ? error.name : null;
  return typeof name === "string" ? DOM_ERROR_KINDS[name] ?? "unknown" : "unknown";
}

export async function runPushSetupStage<T>(
  stage: PushSetupStage,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PushSetupError) throw error;
    throw new PushSetupError(stage, browserFailureKind(error));
  }
}

export function pushSetupHttpError(
  stage: Extract<PushSetupStage, "config" | "server_status" | "server_register">,
  status: number,
): PushSetupError {
  const kind: PushSetupFailureKind = status === 401
    ? "unauthorized"
    : status === 409
      ? "account_changed"
      : status === 429
        ? "rate_limited"
        : status >= 500
          ? "unavailable"
          : "invalid_response";
  return new PushSetupError(stage, kind);
}

export function pushSetupTelemetryCode(
  context: "reconcile" | "manual",
  error: unknown,
): string {
  const failure = error instanceof PushSetupError
    ? error
    : new PushSetupError("subscription_create", browserFailureKind(error));
  return `push_${context}_${failure.stage}_${failure.kind}`;
}

export function pushSetupRecoveryMessage(
  error: unknown,
  braveBrowser: boolean,
  locale: "en" | "he" = "en",
): string {
  const failure = error instanceof PushSetupError
    ? error
    : new PushSetupError("subscription_create", browserFailureKind(error));

  if (locale === "he") {
    if (
      failure.stage === "subscription_create"
      && (failure.kind === "invalid_key" || failure.kind === "unsupported")
    ) {
      return "מפתח ההתראות של ChessRiot אינו תקין. זו בעיית הגדרה בשירות; נסו שוב מאוחר יותר.";
    }
    if (failure.stage === "config") {
      return "ChessRiot לא הצליח לטעון את הגדרות ההתראות. בדקו את החיבור ונסו שוב מאוחר יותר דרך ההגדרות.";
    }
    if (failure.stage === "service_worker") {
      return "ChessRiot לא הצליח להפעיל התראות ברקע. פתחו מחדש את ChessRiot ונסו שוב דרך ההגדרות.";
    }
    if (failure.stage === "subscription_create" && braveBrowser) {
      return "Brave אישר התראות אך לא הצליח ליצור חיבור Push. הפעילו ב־Brave את Settings → Privacy and security → Use Google services for push messaging, פתחו מחדש את ChessRiot ונסו שוב.";
    }
    if (failure.stage === "subscription_create") {
      return "הדפדפן אישר התראות אך לא הצליח להתחבר לשירות ה־Push שלו. פתחו מחדש את ChessRiot ונסו שוב דרך ההגדרות.";
    }
    if (failure.stage === "subscription_read" || failure.stage === "subscription_replace") {
      return "חיבור ההתראות בדפדפן זקוק לתיקון. פתחו מחדש את ChessRiot ונסו שוב דרך ההגדרות.";
    }
    if (failure.stage === "subscription_serialize") {
      return "הדפדפן החזיר חיבור התראות חלקי. נסו שוב דרך ההגדרות או השתמשו ב־Chrome.";
    }
    if (failure.kind === "unauthorized" || failure.kind === "account_changed") {
      return "חשבון ChessRiot השתנה לפני שהמכשיר נשמר. טענו מחדש את ChessRiot ונסו שוב דרך ההגדרות.";
    }
    if (failure.kind === "rate_limited") {
      return "בוצעו יותר מדי ניסיונות להגדרת התראות. נסו שוב מאוחר יותר דרך ההגדרות.";
    }
    if (failure.stage === "server_register") {
      return "הדפדפן מוכן, אבל ChessRiot לא הצליח לשמור את המכשיר. בדקו את החיבור ונסו שוב דרך ההגדרות.";
    }
    return "ChessRiot לא הצליח לאמת את מצב ההתראות. נסו שוב דרך ההגדרות.";
  }

  if (
    failure.stage === "subscription_create"
    && (failure.kind === "invalid_key" || failure.kind === "unsupported")
  ) {
    return "ChessRiot’s notification key is invalid. This is a ChessRiot configuration problem; retry later.";
  }
  if (failure.stage === "config") {
    return "ChessRiot could not load notification configuration. Check your connection and retry later from Settings.";
  }
  if (failure.stage === "service_worker") {
    return "ChessRiot could not start background notifications. Reopen ChessRiot and retry from Settings.";
  }
  if (failure.stage === "subscription_create" && braveBrowser) {
    return "Brave allowed notifications but could not create a push subscription. In Brave, turn on Settings → Privacy and security → Use Google services for push messaging, reopen ChessRiot, then retry from Settings.";
  }
  if (failure.stage === "subscription_create") {
    return "Your browser allowed notifications but could not connect to its push service. Reopen ChessRiot and retry from Settings.";
  }
  if (failure.stage === "subscription_read" || failure.stage === "subscription_replace") {
    return "This browser’s notification subscription needs repair. Reopen ChessRiot and retry from Settings.";
  }
  if (failure.stage === "subscription_serialize") {
    return "This browser returned an incomplete notification subscription. Retry from Settings or use Chrome.";
  }
  if (failure.kind === "unauthorized" || failure.kind === "account_changed") {
    return "Your ChessRiot session changed before this device was saved. Reload ChessRiot and retry from Settings.";
  }
  if (failure.kind === "rate_limited") {
    return "Too many notification setup attempts were made. Retry later from Settings.";
  }
  if (failure.stage === "server_register") {
    return "Your browser is ready, but ChessRiot could not save this device. Check your connection and retry from Settings.";
  }
  return "ChessRiot could not verify notification status. Retry from Settings.";
}
