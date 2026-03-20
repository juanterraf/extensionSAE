# Chrome Web Store - Datos para la publicacion

## Nombre
SAE Tucuman - Asistente de Expedientes

## Descripcion corta (132 caracteres max)
Consulta, resume y descarga expedientes judiciales del portal SAE de Tucuman con seguimiento automatico.

## Descripcion detallada

Herramienta gratuita para profesionales del derecho que trabajan con el Sistema de Administracion de Expedientes (SAE) del Poder Judicial de Tucuman.

FUNCIONES PRINCIPALES

- Busqueda rapida: Busca expedientes por numero, actor o demandado seleccionando centro judicial y fuero.

- Deteccion automatica: Si estas navegando un expediente en el portal SAE, la extension lo detecta y carga automaticamente.

- Resumen de tramites: Genera un resumen del ultimo tramite o un informe general completo de toda la causa.

- Descarga completa: Descarga todos los tramites como ZIP incluyendo PDFs, textos de proveidos y un informe general.

- Seguimiento de causas: Agrega expedientes a tu lista de seguimiento. La extension verifica automaticamente cada 30 minutos si hay movimientos nuevos y te notifica.

- Importacion masiva: Carga un archivo Excel o CSV con numeros de expediente para consultar multiples causas de una vez. Exporta los resultados como Excel.

COMO USAR

1. Abri consultaexpedientes.justucuman.gov.ar en una pestana
2. Navega a un expediente o usa la pestana "Buscar" en la extension
3. Desde el expediente podes generar resumenes, descargar archivos o agregar a seguimiento
4. Para importacion masiva, necesitas estar en la pagina del buscador del SAE (el captcha se obtiene de ahi)

IMPORTANTE

- Herramienta experimental y gratuita
- No es un producto oficial del Poder Judicial de Tucuman
- El uso queda bajo la exclusiva responsabilidad del usuario
- No recopila ni transmite datos personales

Desarrollado por Juan Pablo Terraf - derechointeligente.com.ar

## Categoria
Productivity

## Idioma
Espanol

## URL de politica de privacidad
https://derechointeligente.com.ar/privacidad-sae
(O subir PRIVACY_POLICY.md como pagina en tu web)

## Justificacion de permisos (para el formulario del Store)

### activeTab
Necesario para detectar si el usuario esta navegando el portal SAE y leer la URL actual para identificar el expediente que esta viendo.

### tabs
Necesario para buscar pestanas abiertas del portal SAE donde se pueda obtener el token reCAPTCHA requerido por la API del SAE para realizar busquedas.

### storage
Necesario para guardar localmente el historial de consultas recientes y la lista de expedientes que el usuario eligio seguir. Los datos se almacenan unicamente en el dispositivo.

### downloads
Necesario para permitir al usuario descargar expedientes completos como archivo ZIP conteniendo PDFs y textos de tramites.

### scripting
Necesario para inyectar scripts en las paginas del portal SAE que permiten interceptar los datos que la propia aplicacion web ya cargo (evitando duplicar llamadas a la API) y obtener tokens reCAPTCHA.

### alarms
Necesario para programar verificaciones periodicas (cada 30 minutos) de los expedientes que el usuario esta siguiendo, detectando nuevos movimientos.

### notifications
Necesario para notificar al usuario cuando se detectan nuevos movimientos en los expedientes que esta siguiendo.

### host_permissions: consultaexpedientes.justucuman.gov.ar
Sitio web del portal SAE donde la extension inyecta content scripts para detectar expedientes y obtener tokens de autenticacion.

### host_permissions: conexpbe.justucuman.gov.ar
API backend del portal SAE. La extension realiza consultas directas a esta API para buscar expedientes, obtener historiales y descargar documentos.
