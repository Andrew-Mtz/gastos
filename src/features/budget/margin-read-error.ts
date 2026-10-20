type MarginFailure =
  | 'TRANSPORT'
  | 'RPC'
  | 'INVALID_CONTRACT'
  | 'INCOMPATIBLE_DATA'
  | 'OUT_OF_RANGE'
  | 'ACCESS';

/** Only fixed, non-personal diagnostics cross into the query cache and UI.
 * Never retain a provider message, details, payload or original error as cause. */
export class MarginReadError extends Error {
  constructor(readonly reason: MarginFailure) {
    super(`MARGIN_${reason}`);
    this.name = 'MarginReadError';
  }
}

export function marginRpcError(error: unknown, status?: number) {
  // The installed PostgREST client uses status 0 when no HTTP response completed.
  // This includes cancellation/timeouts, not just a disconnected device.
  if (status === 0) return new MarginReadError('TRANSPORT');
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : null;
  if (code === '23514') return new MarginReadError('INCOMPATIBLE_DATA');
  if (code === '22003') return new MarginReadError('OUT_OF_RANGE');
  if (code === '42501') return new MarginReadError('ACCESS');
  return new MarginReadError('RPC');
}

export function safeToSpendErrorMessage(error: unknown) {
  const failure =
    error instanceof MarginReadError ? error : marginRpcError(error);
  switch (failure.reason) {
    case 'TRANSPORT':
      return 'No se completó la conexión con el servicio. Comprueba la conexión y reintenta. El margen seguirá oculto hasta recibir datos válidos. Referencia: MARGEN-CONEXION.';
    case 'INVALID_CONTRACT':
      return 'La respuesta recibida no pasó la validación del resumen. No se mostrará un margen parcial. Reintenta; si continúa, comparte esta referencia y la versión de la app para revisar la compatibilidad y consistencia de los datos. Referencia: MARGEN-RESPUESTA.';
    case 'INCOMPATIBLE_DATA':
      return 'Hay datos incompatibles de moneda, fondos o ahorro. No se mostrará un margen parcial; revisa los registros. Referencia: MARGEN-DATOS.';
    case 'OUT_OF_RANGE':
      return 'El margen supera los importes que pueden calcularse con precisión. No se mostrará una aproximación. Referencia: MARGEN-LIMITE.';
    case 'ACCESS':
      return 'No se pudo acceder a este período. Revisa tu sesión. Referencia: MARGEN-ACCESO.';
    case 'RPC':
      return 'El servicio no pudo completar la consulta del margen. No se considerarán cero los gastos ni compromisos. Reintenta; si continúa, comparte esta referencia y la versión de la app. Referencia: MARGEN-SERVICIO.';
  }
}
