export type AvailabilityReason = 'airport' | 'mass' | 'fuel' | 'sun' | 'geometry';
export interface AvailabilityChoice {
    id: string;
    allowed: boolean;
    reasons: readonly string[];
}
export interface MissionAvailability {
    status: 'checking' | 'available' | 'unresolved' | 'no_safe_choices' | 'busy' | 'terminal' | 'failed';
    key: string | null;
    checked: number;
    total: number;
    remaining: number;
    complete: boolean;
    availableIds: string[];
    unresolvedIds: string[];
    blockedCount: number;
    reasons: Record<AvailabilityReason, number>;
}
/** A known resource/policy block is sufficient even when solar safety is unresolved.
 * Unknown/context-only reasons never establish a planning dead end. */
export declare function availabilityReason(choice: Pick<AvailabilityChoice, 'allowed' | 'reasons'>): AvailabilityReason | 'available' | 'unresolved';
export declare function inactiveAvailability(status: 'busy' | 'terminal', total?: number): MissionAvailability;
/** Transport-independent progress for one immutable planning snapshot. No camera inputs. */
export declare class MissionAvailabilityScan {
    #private;
    readonly key: string;
    constructor(key: string, destinationIds: readonly string[]);
    accept(key: string, batch: readonly AvailabilityChoice[], done?: boolean): boolean;
    fail(): void;
    summary(): MissionAvailability;
}
