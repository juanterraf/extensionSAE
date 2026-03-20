# SAE Tucuman - Asistente de Expedientes

Extension de Google Chrome para consultar, resumir y descargar expedientes judiciales del [portal SAE del Poder Judicial de Tucuman](https://consultaexpedientes.justucuman.gov.ar/).

Herramienta gratuita para profesionales del derecho.

## Funciones

- **Busqueda de expedientes** - Por numero, actor o demandado, seleccionando centro judicial y fuero.
- **Deteccion automatica** - Si estas navegando un expediente en el portal SAE, la extension lo detecta y carga sus datos.
- **Resumen de tramites** - Resumen del ultimo tramite o informe general de toda la causa.
- **Informe con IA** - Genera un analisis profesional del expediente usando Gemini (requiere API key gratuita de Google AI Studio).
- **Descarga completa** - Descarga todos los tramites como ZIP incluyendo PDFs, textos de proveidos y un informe general.
- **Seguimiento de causas** - Agrega expedientes a tu lista de seguimiento. La extension verifica cada 30 minutos si hay movimientos nuevos y te notifica.
- **Importacion masiva** - Carga un archivo Excel o CSV con numeros de expediente para consultar multiples causas de una vez.

## Instalacion

### Opcion 1: Desde el codigo fuente

1. Descarga o clona este repositorio:
   ```
   git clone https://github.com/juanterraf/extensionSAE.git
   ```
   O descarga el ZIP desde el boton verde **Code > Download ZIP** y descomprimilo.

2. Abri Google Chrome y navega a:
   ```
   chrome://extensions
   ```

3. Activa el **Modo de desarrollador** (esquina superior derecha).

4. Hace click en **Cargar extension sin empaquetar**.

5. Selecciona la carpeta del repositorio (la que contiene `manifest.json`).

6. La extension aparece en la barra de herramientas de Chrome.

### Opcion 2: Desde ZIP

1. Descarga el archivo ZIP desde [Releases](https://github.com/juanterraf/extensionSAE/releases).
2. Descomprimilo en una carpeta.
3. Segui los pasos 2 a 6 de la opcion anterior.

> **Nota:** Chrome muestra un aviso de "extensiones en modo desarrollador" cada vez que abris el navegador. Es normal, hace click en "Descartar".

## Como usar

### Requisito previo

Tene abierta una pestana con el portal SAE: `consultaexpedientes.justucuman.gov.ar`

### Consultar un expediente

1. **Desde el portal:** Navega a cualquier expediente en el SAE. La extension lo detecta automaticamente.
2. **Desde la extension:** Abri la extension, selecciona centro y fuero, e ingresa numero de expediente, actor o demandado.

### Generar resumenes

Desde la pestana "Expediente":
- **Ultimo Tramite** - Resumen rapido del movimiento mas reciente.
- **Informe General** - Listado cronologico de todos los tramites.
- **Informe IA** - Analisis profesional generado por inteligencia artificial (requiere configurar API key).

### Configurar IA (opcional)

1. Obtene una API key gratuita en [Google AI Studio](https://aistudio.google.com/apikey).
2. En la extension, anda a la pestana **Info > Configuracion IA**.
3. Pega tu API key y guarda.

### Descargar expediente completo

Hace click en **Descargar Todo (ZIP)** para obtener un archivo con:
- Informe general en texto
- PDFs de cada tramite que tenga documento
- Textos de proveidos y resoluciones
- Metadata de cada movimiento

> **Importante:** No cierres ni cambies de pestana mientras se genera el ZIP.

### Seguimiento de causas

1. Desde cualquier expediente, hace click en **Seguir esta causa**.
2. La extension verifica automaticamente cada 30 minutos si hay movimientos nuevos.
3. Los nuevos movimientos se marcan con un indicador visual.
4. Recibis notificaciones de escritorio cuando hay novedades.

### Importacion masiva

1. Prepara un archivo Excel (.xlsx) o CSV con las siguientes columnas:
   - `expediente` o `numero` (obligatorio) - Numero del expediente (ej: 1512/25)
   - `fuero` (opcional) - Si no coincide con el fuero seleccionado, se omite
   - `centro` (opcional) - Si no coincide con el centro seleccionado, se omite

2. En la extension, selecciona centro y fuero.
3. En la pestana **Importar**, sube el archivo.
4. Hace click en **Procesar**.

> **Nota:** La importacion requiere estar en la pagina del buscador del SAE (necesita el captcha). Procesa ~10-20 expedientes por minuto.

## Estructura del proyecto

```
extensionSAE/
  manifest.json          # Configuracion de la extension
  popup/                 # Interfaz del popup
    popup.html
    popup.css
    popup.js
  background/            # Service worker (notificaciones, descargas)
    service-worker.js
  content/               # Scripts inyectados en el portal SAE
    content-script.js
    content-style.css
    inject-intercept.js
  icons/                 # Iconos de la extension
  lib/                   # Librerias (JSZip, SheetJS)
```

## Disclaimer

- Esta es una herramienta **experimental y gratuita**.
- **No** es un producto oficial del Poder Judicial de Tucuman.
- El uso queda bajo la **exclusiva responsabilidad** del usuario.
- No recopila ni transmite datos personales. Toda la informacion se almacena localmente en el navegador.

## Autor

**Juan Pablo Terraf**
[derechointeligente.com.ar](https://derechointeligente.com.ar)

## Licencia

MIT
