export const GOOGLE_APPS_SCRIPT_PULL_V18 = String.raw`

// ============================================================
// O-RA STORE - V18 PULL FALLBACK DISABLED
// The Google-driven pull experiment added permission/key/trigger failures on top
// of the real order->Sheet issue. Keep only a harmless handler so any previously
// installed time trigger cannot fail while V17 remains the final active writer.
// ============================================================
function oraStablePullOrdersFromServer(){
  return {
    ok:true,
    status:"pull_disabled",
    message:"Google pull fallback is disabled. V17 direct Apps Script sync is active.",
    version:typeof ORA_VERSION!=="undefined"?ORA_VERSION:"O-RA Google Sheet Sync"
  };
}
`;
