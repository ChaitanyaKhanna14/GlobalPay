/**
 * Minimal react-native surface for Node-based tests. Only the pieces the
 * security layer touches are provided; anything else is intentionally absent so
 * an accidental UI import fails loudly rather than silently passing.
 */
export const Platform = {
  OS: 'ios' as const,
  select: <T,>(spec: { ios?: T; android?: T; web?: T; default?: T }): T | undefined =>
    spec.ios ?? spec.default,
};
