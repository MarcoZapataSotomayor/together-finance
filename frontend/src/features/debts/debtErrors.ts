import { ApiError } from '../../api/client.ts'

export function debtError(error: unknown, operation = 'read') {
  if (error instanceof ApiError) {
    if (error.status === 400)
      return 'Revisa las personas, los filtros y las fechas. El monto debe ser positivo, con máximo dos decimales; el vencimiento o pago no puede ser anterior a la deuda.'
    if (error.status === 401)
      return 'Tu sesión terminó. Ingresa de nuevo para continuar; tu formulario se conserva en esta pestaña.'
    if (error.status === 403)
      return 'No pudimos verificar el acceso. Revalida la sesión y reintenta; no se enviará nada automáticamente.'
    if (error.status === 404)
      return 'No encontramos este registro. Puede que el envío aún no se haya confirmado. Revisa el historial o reintenta con el mismo identificador.'
    if (error.status === 409)
      return operation === 'payment' || operation === 'restore'
        ? 'No pudimos confirmar el pago o la restauración: puede superar el pendiente actual, existir un envío con ese identificador o estar inactiva la deuda. Consulta el registro y actualiza el detalle antes de reintentar.'
        : 'Hay un conflicto. Los pagos, incluso eliminados, protegen el monto original, las personas y la fecha. También puede existir un envío previo o un cambio simultáneo. Revisa el registro antes de reintentar.'
    if (error.status === 429)
      return 'Hay demasiados intentos. Espera unos minutos y vuelve a intentar.'
  }
  return 'No pudimos confirmar la operación. El servidor puede estar despertando o la conexión falló. Conservamos tus campos; consulta el envío o reintenta con el mismo identificador.'
}
