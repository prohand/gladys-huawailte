# Huawei LTE

Esta integración conecta Gladys con un **router Huawei 4G/5G** o un **módem
USB HiLink** (B310, B315, B525, B535, B618, B818, E5186, E5576, E3372h, 5G
CPE…). Muestra la señal, las velocidades y los datos usados este mes, envía
SMS desde sus escenas y lanza una escena cuando llega un SMS o se cae la
conexión.

## Antes de empezar

- Se necesita **Gladys 5.3 o posterior**.
- Gladys debe alcanzar el router en su red local: abra su página web
  (normalmente `http://192.168.8.1`) desde el equipo donde funciona Gladys
  para comprobarlo.
- Tenga a mano la **contraseña de la página web del router**. Todo queda en su
  red: la integración nunca usa internet ni una cuenta de Huawei.

## Configuración

| Campo                               | Qué poner                                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| Dirección del router                | La dirección de su página web, `http://192.168.8.1` por defecto                               |
| Nombre de usuario                   | `admin` en casi todos los modelos                                                             |
| Contraseña                          | La contraseña de la página web; vacía para un módem HiLink sin inicio de sesión               |
| Intervalo de actualización (s)      | Cada cuánto se lee el router (15 a 3600 s, 60 por defecto)                                    |
| Vigilar los SMS recibidos           | Activa «Se recibe un SMS» para cada mensaje nuevo                                             |
| Marcar como leídos los SMS tratados | Marca el mensaje como leído en el router una vez activado el disparador                       |
| Botones de control en el panel      | Muestra «Enviar un SMS», «Datos móviles» y «Reiniciar» en el widget (desactivado por defecto) |

Pulse luego **Probar la conexión**: la respuesta indica el modelo, el
operador, el tipo de red y la señal. **Enviar un SMS de prueba** comprueba
que la tarjeta SIM puede enviar mensajes.

## Lo que obtiene en Gladys

Una vez leído el router, aparece en la pestaña **Descubrimiento**. Añádalo:
trae estas funciones.

| Función                      | Unidad   | Notas                                         |
| ---------------------------- | -------- | --------------------------------------------- |
| Señal (barras)               | 0 a 5    | Como la muestra el router                     |
| RSRP, RSRQ, SINR             | dBm, dB  | Calidad de radio, útil para colocar el router |
| Internet conectado           | 0 / 1    | 1 cuando la conexión móvil está activa        |
| Velocidad de bajada / subida | Mbit/s   | Velocidades actuales                          |
| Datos descargados / subidos  | GB       | Este mes, contados por el router              |
| Conectado desde hace         | minutos  | Duración de la conexión actual                |
| Datos móviles                | on / off | La única función que se puede controlar       |
| SMS sin leer                 | número   |                                               |
| Tipo de red, operador        | texto    | p. ej. `LTE+`, `Movistar`                     |
| Dirección IP WAN             | texto    | La dirección dada por el operador             |

Un valor que su modelo no da simplemente no se muestra.

## Escenas

### Disparadores

- **Se recibe un SMS**: ha llegado un mensaje nuevo a la bandeja del router.
  Puede quedarse con un solo remitente (el número exactamente como lo muestra
  el router, p. ej. `+34612345678`). La escena recibe el **remitente**, el
  **mensaje** y la **fecha**.
- **La conexión a internet cambia**: el router se conecta, pierde la red
  móvil o deja de responder («Router inaccesible»). Elija los estados que le
  interesan. La escena recibe el estado nuevo y el anterior, el tipo de red y
  el operador.

### Acciones

- **Enviar un SMS**: a 5 números como máximo, separados por comas. El mensaje
  puede usar variables de escena (p. ej. la temperatura de un sensor).
- **Reiniciar el router**: internet se corta de uno a tres minutos. El
  «Router inaccesible» que causa el reinicio no lanza ninguna escena.

## Widget del panel

El widget **Router Huawei LTE** muestra la señal, las velocidades, los datos
usados este mes, la conexión, el tipo de red, el operador y los SMS sin leer.
La dirección IP WAN está oculta salvo que active **Mostrar la dirección IP
WAN** en los ajustes del widget.

Los botones que actúan sobre el router (**Enviar un SMS**, **Datos móviles**,
**Reiniciar**) solo aparecen si **Botones de control en el panel** está
activado en la configuración: cualquiera que vea el panel puede usarlos.

## SMS

- En el primer arranque, los mensajes que ya esperan en la bandeja no lanzan
  ninguna escena: solo lo hacen los recibidos después.
- Con **Marcar como leídos los SMS tratados** desactivado, la integración
  recuerda los mensajes ya tratados (en su propio almacenamiento): un
  reinicio no lanza dos veces la misma escena.
- Los mensajes nuevos se detectan en cada actualización (60 s por defecto).
- Los routers Huawei guardan un número limitado de mensajes: vacíe la bandeja
  de vez en cuando desde la página web del router.

## Solución de problemas

| Mensaje                                                | Qué hacer                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| El router no responde                                  | Compruebe la dirección, y que Gladys funciona en la misma red que el router                            |
| El router rechazó el nombre de usuario o la contraseña | Vuelva a escribir la contraseña de la página web. La integración espera 10 minutos antes de reintentar |
| El router bloqueó el inicio de sesión                  | Demasiados intentos fallidos: espere unos minutos y pruebe de nuevo                                    |
| El router pide iniciar sesión                          | Indique la contraseña                                                                                  |

El router solo admite unas pocas sesiones a la vez: si su página web indica
demasiados usuarios conectados, cierre la sesión en la página web o espere
unos minutos.

## Privacidad y seguridad

- Gladys guarda la contraseña como un secreto y solo se envía al router.
- La integración solo habla con la dirección del router que indicó, en su red
  local.
- El contenido de los SMS solo se entrega a sus escenas, nunca se escribe en
  los registros.
