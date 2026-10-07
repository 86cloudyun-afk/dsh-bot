/** Descriptive immutable profile choice; not a capability. */
export interface GuiDelegationPolicy {
 readonly parentWorkTools:'delegate';readonly childWorkTools:'none';readonly maxDepth:1;readonly workLimit:15;
}
export declare const GUI_DELEGATION_POLICY:Readonly<GuiDelegationPolicy>;
export declare function freezeGuiDelegationPolicy(value?:GuiDelegationPolicy):Readonly<GuiDelegationPolicy>;
