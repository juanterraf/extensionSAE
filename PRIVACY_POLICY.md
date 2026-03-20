# Politica de Privacidad - SAE Tucuman Extension

**Ultima actualizacion:** 20 de marzo de 2026

## Informacion general

SAE Tucuman - Asistente de Expedientes ("la Extension") es una herramienta gratuita desarrollada por Juan Pablo Terraf (derechointeligente.com.ar) que facilita la consulta de expedientes judiciales publicados en el portal SAE del Poder Judicial de Tucuman (consultaexpedientes.justucuman.gov.ar).

## Datos que recopila la Extension

La Extension **NO recopila, transmite ni comparte datos personales** con terceros.

### Datos almacenados localmente

La Extension almacena los siguientes datos **unicamente en el dispositivo del usuario** mediante Chrome Storage Local:

- **Historial de consultas**: numeros de expediente y caratulas consultadas recientemente (ultimos 50).
- **Lista de seguimiento**: expedientes que el usuario eligio monitorear, incluyendo el ultimo estado conocido.
- **Resultados de importacion**: datos temporales de consultas masivas durante la sesion activa.

Estos datos:
- Se almacenan **solo en el navegador del usuario**
- **No se transmiten** a ningun servidor externo
- **No se sincronizan** entre dispositivos
- Pueden ser **eliminados en cualquier momento** por el usuario desinstalando la Extension o limpiando los datos de la extension desde chrome://extensions

### Datos que NO recopila

- No recopila informacion personal identificable
- No recopila datos de navegacion fuera del portal SAE
- No utiliza cookies propias
- No contiene rastreadores, analytics ni publicidad
- No transmite datos a servidores propios ni de terceros

## Comunicaciones con servidores externos

La Extension se comunica **unicamente** con los servidores oficiales del Poder Judicial de Tucuman:

- `consultaexpedientes.justucuman.gov.ar` - Portal SAE (interfaz web)
- `conexpbe.justucuman.gov.ar` - API backend del SAE (datos de expedientes)

Estas comunicaciones son las mismas que realiza el portal web cuando un usuario consulta expedientes manualmente. La Extension no agrega, modifica ni intercepta datos en estas comunicaciones mas alla de lo necesario para su funcionamiento.

## Permisos utilizados

| Permiso | Uso |
|---------|-----|
| activeTab / tabs | Detectar si el usuario esta en el portal SAE |
| storage | Guardar historial y seguimiento localmente |
| downloads | Permitir descarga de expedientes como ZIP |
| scripting | Interactuar con la pagina del portal SAE |
| alarms | Verificar periodicamente actualizaciones en causas seguidas |
| notifications | Notificar al usuario sobre nuevos movimientos |

## Derechos del usuario

El usuario puede en cualquier momento:
- Dejar de seguir cualquier expediente
- Eliminar el historial de consultas
- Desinstalar la Extension, lo cual elimina todos los datos almacenados

## Cambios a esta politica

Cualquier cambio en esta politica se reflejara en la actualizacion de la Extension y en este documento.

## Contacto

Juan Pablo Terraf
Web: https://derechointeligente.com.ar
