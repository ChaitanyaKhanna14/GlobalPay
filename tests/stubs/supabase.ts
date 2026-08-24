/**
 * Controllable Supabase stand-in for Node-based tests.
 *
 * The event log mirrors events to Supabase, but the hash chain, risk engine,
 * and detection rules must remain testable without a network or credentials.
 *
 * The default posture is "no session", which makes the sync layer queue and
 * return without ever attempting a request — exercising the same offline path a
 * real device takes on a plane, and keeping every unrelated test hermetic.
 *
 * Tests that need to exercise the sync layer itself opt in via
 * `configureSupabaseStub`, which can grant a session, record what was uploaded,
 * inject errors, and run a hook *during* an in-flight upsert so concurrency can
 * be reproduced deterministically instead of with timers.
 */

export interface SupabaseStubConfig {
  /** When null, the sync layer treats the device as signed out. */
  session: unknown;
  /** Batches passed to upsert, in order. */
  upserted: Record<string, unknown>[][];
  /** Returned from upsert when set, simulating a rejected write. */
  upsertError: { message: string } | null;
  /** Runs while an upsert is in flight — the window a concurrent append hits. */
  onUpsert?: (rows: Record<string, unknown>[]) => void | Promise<void>;
  /** Rows returned by select(). */
  selectRows: Record<string, unknown>[];
  /** Value returned by rpc('is_soc_analyst'). */
  isAnalyst: boolean;
}

const defaults = (): SupabaseStubConfig => ({
  session: null,
  upserted: [],
  upsertError: null,
  onUpsert: undefined,
  selectRows: [],
  isAnalyst: false,
});

export const supabaseStub: SupabaseStubConfig = defaults();

/** Reset to the hermetic default, then apply any overrides. */
export function configureSupabaseStub(overrides: Partial<SupabaseStubConfig> = {}): void {
  Object.assign(supabaseStub, defaults(), overrides);
}

export const supabase = {
  auth: {
    async getSession() {
      return { data: { session: supabaseStub.session } };
    },
  },
  from() {
    return {
      async upsert(rows: Record<string, unknown>[]) {
        supabaseStub.upserted.push(rows);
        if (supabaseStub.onUpsert) await supabaseStub.onUpsert(rows);
        return { error: supabaseStub.upsertError };
      },
      select() {
        return {
          order() {
            return {
              async limit() {
                return { data: supabaseStub.selectRows, error: null };
              },
            };
          },
        };
      },
    };
  },
  async rpc() {
    return { data: supabaseStub.isAnalyst, error: null };
  },
};
