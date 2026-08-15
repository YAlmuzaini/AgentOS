/**
 * Injection token lives apart from the module so providers can import it
 * without creating a module -> provider -> module import cycle.
 */
export const REDIS = Symbol("REDIS");
