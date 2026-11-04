export class ConfigError extends Error {}

export class AuthError extends Error {}

/** The connection is gone; the run cannot continue. */
export class ConnectionLostError extends Error {}
