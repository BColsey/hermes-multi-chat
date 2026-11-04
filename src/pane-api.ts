import { connectionParams, type Target } from "./state";
export type Inspection =
  | { retained: false }
  | {
      retained: true;
      session_id: string | null;
      params: { channel: string; attach: string };
    };
/** Observation, not a second execution API. Only an explicit new/resume intent
 * grants one creation attempt; restoration and network retries never do. */
export class PaneAPI {
  constructor(
    private target: Target,
    readonly read: () => Promise<Inspection>,
    private mayCreate: boolean,
    private attempted: () => void,
  ) {}
  async params(): Promise<Record<string, string>> {
    const state = await this.read();
    if (state.retained) {
      if (
        state.params.channel !== this.target.channel ||
        !(
          state.params.attach === this.target.attach ||
          state.params.attach.startsWith(this.target.attach + "\0")
        )
      )
        throw new Error("Retained terminal identity mismatch.");
      return state.params;
    }
    if (!this.mayCreate)
      throw new Error(
        "No retained terminal. Close this view and explicitly resume its saved conversation; no replacement was spawned.",
      );
    this.mayCreate = false;
    this.attempted();
    return connectionParams(this.target);
  }
}
