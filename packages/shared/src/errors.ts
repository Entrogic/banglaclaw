export class BanglaClawError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class ConfigError extends BanglaClawError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("CONFIG_ERROR", message, options);
  }
}

export class ToolValidationError extends BanglaClawError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("TOOL_VALIDATION_ERROR", message, options);
  }
}

export class ToolPermissionError extends BanglaClawError {
  constructor(message: string) {
    super("TOOL_PERMISSION_DENIED", message);
  }
}

export class ToolExecutionError extends BanglaClawError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("TOOL_EXECUTION_ERROR", message, options);
  }
}

export class ProviderError extends BanglaClawError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("PROVIDER_ERROR", message, options);
  }
}

export class RunLimitError extends BanglaClawError {
  constructor(message: string) {
    super("RUN_LIMIT_EXCEEDED", message);
  }
}
