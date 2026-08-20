/**
 * Inert Supabase client for Node-based tests.
 *
 * The event log now mirrors events to Supabase, but the hash chain, risk
 * engine, and detection rules must remain testable without a network or
 * credentials. This stub reports "no session", which makes the sync layer
 * queue and return without ever attempting a request — exercising the same
 * offline path a real device takes on a plane.
 */
export const supabase = {
  auth: {
    async getSession() {
      return { data: { session: null } };
    },
  },
  from() {
    return {
      async upsert() {
        return { error: null };
      },
      select() {
        return {
          order() {
            return {
              async limit() {
                return { data: [], error: null };
              },
            };
          },
        };
      },
    };
  },
  async rpc() {
    return { data: false, error: null };
  },
};
