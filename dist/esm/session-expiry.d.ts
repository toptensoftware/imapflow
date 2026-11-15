export declare const DEFAULT_SESSION_EXPIRY_LEAD: number;
/** When the two session expiry timers fire, in milliseconds from now */
export interface SessionExpiryPlan {
    /** Start closing the connection at its first free moment */
    dueIn: number;
    /** Close the connection whatever it is doing */
    closeIn: number;
}
/**
 * Turns the `sessionExpires` and `sessionExpiryLead` options into timer delays.
 *
 * @param sessionExpires When the server ends the session, a Date or milliseconds since the epoch
 * @param sessionExpiryLead How long before that to start looking for a free moment, in milliseconds
 * @param now Current time in milliseconds since the epoch
 * @returns The delays, or `null` when no usable expiry was given
 */
export declare function planSessionExpiry(sessionExpires: Date | number | undefined, sessionExpiryLead: number | undefined, now: number): SessionExpiryPlan | null;
