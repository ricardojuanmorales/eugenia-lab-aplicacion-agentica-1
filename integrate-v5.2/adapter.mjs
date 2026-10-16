// Adaptador de prueba, sin E/S de red, persistencia ni efectos sobre la aplicación.
export function createIntegrateSession({ enabled = false, dryRun = true } = {}) {
  if (!dryRun) throw new Error('POC solo admite dryRun=true; requiere aprobación humana para ejecución real.');
  const snapshot = Object.freeze({
    framework: '5.2.0', mode: 'INTEGRATE', enabled: Boolean(enabled),
    dryRun: true, isolated: true, preservationRule: 'preserve_source',
    activeProfiles: Object.freeze(['PH', 'IT']), latentProfiles: Object.freeze(['AT']),
    status: enabled ? 'simulated' : 'inactive'
  });
  return snapshot;
}
