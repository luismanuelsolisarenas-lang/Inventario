# Servicio de Reporte de Inventario — SOA

API REST con Node.js, Express y MySQL. Consulta el inventario actual y devuelve reportes JSON. El alcance es **solo lectura**: un servicio de productos o inventario sería responsable de registrar entradas, salidas y cambios de precios.

## 1. Entender la arquitectura

```text
Cliente (Postman / navegador / otro servicio)
  → HTTP GET → rutas → servicio de reportes → repositorio → MySQL
  ← JSON     ←       ←                    ←             ←
```

En SOA este servicio tiene una responsabilidad concreta, un contrato HTTP versionado y puede ser consumido por distintas aplicaciones sin que conozcan su implementación. Las solicitudes son independientes (sin sesión). Las rutas manejan HTTP, la capa de servicio aplica reglas y el repositorio concentra SQL. Tener capas no convierte por sí solo una aplicación en SOA: su integración mediante un contrato es la parte esencial.

```text
Inventario/
├── src/
│   ├── app.js
│   ├── server.js
│   ├── db.js
│   ├── routes/report.routes.js
│   ├── services/report.service.js
│   └── repositories/inventory.repository.js
├── sql/
│   ├── 01-schema.sql
│   └── 02-seed.sql
├── test/report.test.js
├── test/mysql.integration.js
├── requests.http
├── compose.yaml
├── Dockerfile
├── .dockerignore
├── .env.example
├── .gitignore
└── package.json
```

## 2. Instalar dependencias

Requisitos: Node.js 22 o superior, npm y MySQL 8.0.16+ (o Docker Desktop con contenedores Linux para usar MySQL 8.4).

Abre una terminal PowerShell en esta carpeta:

```powershell
npm.cmd install
Copy-Item .env.example .env
```

Si ya tienes un archivo `.env`, conserva su configuración. No publiques credenciales en Git. Las contraseñas incluidas son exclusivamente para desarrollo local.

## 3. Preparar MySQL

### Opción A: Docker Desktop

Con Docker Desktop instalado y en ejecución:

```powershell
docker compose up -d --wait db
```

MySQL crea la base, el usuario y los datos de ejemplo automáticamente. El archivo `.env.example` ya contiene los valores correspondientes. El puerto 3306 debe estar libre; si está ocupado, cambia `DB_PORT` en `.env` (por ejemplo, a `3307`). Compose utiliza ese puerto para acceder desde tu equipo; los contenedores se comunican internamente por el 3306.

Los scripts de inicialización se ejecutan **solo cuando el volumen de datos está vacío**. Reiniciar el contenedor conserva los datos. Para detenerlo sin borrarlos:

```powershell
docker compose down
```

### Opción B: MySQL instalado / MySQL Workbench

Conecta como administrador y ejecuta, en este orden:

1. [sql/01-schema.sql](sql/01-schema.sql): crea tablas, restricciones y relación entre categorías y productos.
2. [sql/02-seed.sql](sql/02-seed.sql): carga cuatro productos de ejemplo.
3. Este SQL crea un usuario con acceso de lectura:

```sql
CREATE USER IF NOT EXISTS 'inventario_app'@'localhost'
IDENTIFIED BY 'inventario_local';
GRANT SELECT ON inventario_soa.* TO 'inventario_app'@'localhost';
```

Si ese usuario ya existe, utiliza su contraseña vigente en `.env`; `IF NOT EXISTS` no la cambia. Ajusta host, puerto y credenciales según tu instalación. El usuario creado automáticamente por Docker tiene permisos más amplios sobre esta base para facilitar la práctica local.

## 4. Iniciar el servicio

```powershell
npm.cmd run dev
```

Para iniciar sin recarga automática usa `npm.cmd start`. Visita <http://localhost:3000/health>:

```json
{ "status": "ok", "database": "up" }
```

El servidor escucha en `HOST`, con valor predeterminado `0.0.0.0`, para aceptar conexiones desde otras máquinas. Para limitarlo a tu equipo al ejecutar Node directamente, configura `HOST=127.0.0.1`. Ctrl+C lo detiene y cierra el pool de conexiones. Arrancar el servidor no confirma que MySQL esté disponible; `/health` comprueba la conexión.

## 5. Contrato REST

| Método | Ruta | Uso |
|---|---|---|
| GET | `/health` | Comprueba la conexión a MySQL |
| GET | `/api/v1/reportes/inventario` | Reporte completo |
| GET | `/api/v1/reportes/inventario?categoriaId=1` | Filtra una categoría |
| GET | `/api/v1/reportes/inventario?stockBajo=true` | Productos que requieren reposición |
| GET | `/api/v1/reportes/inventario?categoriaId=2&stockBajo=true` | Combina filtros |

No se envía cuerpo en estas solicitudes GET. Todas las respuestas son JSON.

Reglas del reporte:

- Stock bajo significa `stock <= stock_minimo`, incluyendo productos con cero unidades.
- Valor por producto = existencias × precio unitario actual. No es un reporte histórico ni contabilidad de costos.
- El resumen se calcula sobre los productos que cumplen **todos** los filtros.
- Una categoría sin coincidencias devuelve HTTP 200, arreglo vacío y totales cero.
- Los importes y `totalUnidades` se devuelven como cadenas para conservar precisión. Los importes tienen dos decimales. La práctica supone una única moneda; no realiza conversiones.
- `generadoEn` es la fecha UTC de generación; el inventario se consulta con una sola sentencia SQL.
- Se rechazan filtros desconocidos, repetidos o inválidos. `stockBajo=false` incluye todos los niveles de stock.

Ejemplo de respuesta para `?categoriaId=2&stockBajo=true`:

```json
{
  "data": {
    "generadoEn": "2026-10-05T18:00:00.000Z",
    "filtros": { "categoriaId": 2, "stockBajo": true },
    "resumen": {
      "totalProductos": 1,
      "totalUnidades": "0",
      "valorInventario": "0.00",
      "productosStockBajo": 1,
      "productosSinStock": 1
    },
    "productos": [
      {
        "id": 4,
        "sku": "ELE-002",
        "nombre": "Mouse",
        "categoriaId": 2,
        "categoria": "Electrónica",
        "stock": 0,
        "stockMinimo": 5,
        "precioUnitario": "150.00",
        "valorTotal": "0.00",
        "stockBajo": true
      }
    ]
  }
}
```

La fecha cambia en cada solicitud; los IDs mostrados corresponden a una base recién inicializada.

| Estado | Significado |
|---|---|
| 200 | Reporte o comprobación de salud correctos |
| 400 | Filtro inválido (`INVALID_FILTER`) |
| 404 | Ruta inexistente (`NOT_FOUND`) |
| 500 | Fallo al consultar o generar reporte (`INTERNAL_ERROR`) |
| 503 | MySQL no disponible al consultar `/health` |

Ejemplo de error:

```json
{ "error": { "code": "INVALID_FILTER", "message": "stockBajo debe ser true o false" } }
```

## 6. Probar manualmente

Con el servidor y MySQL activos, abre otra terminal:

```powershell
Invoke-RestMethod 'http://localhost:3000/health'
Invoke-RestMethod 'http://localhost:3000/api/v1/reportes/inventario' | ConvertTo-Json -Depth 10
Invoke-RestMethod 'http://localhost:3000/api/v1/reportes/inventario?stockBajo=true' | ConvertTo-Json -Depth 10
Invoke-RestMethod 'http://localhost:3000/api/v1/reportes/inventario?categoriaId=2&stockBajo=true' | ConvertTo-Json -Depth 10
curl.exe -i 'http://localhost:3000/api/v1/reportes/inventario?categoriaId=-1'
```

En Postman: crea una solicitud **GET**, pega una de las URL de la tabla, pulsa **Send** y verifica estado y JSON. También puedes usar [requests.http](requests.http) con la extensión REST Client de VS Code.

Resultados esperados con los datos de ejemplo sin modificar:

| Consulta | Productos | Unidades | Valor | Stock bajo | Sin stock |
|---|---:|---:|---:|---:|---:|
| Sin filtros | 4 | 65 | 4315.00 | 2 | 1 |
| `categoriaId=1` | 2 | 55 | 1815.00 | 1 | 0 |
| `stockBajo=true` | 2 | 5 | 40.00 | 2 | 1 |
| `categoriaId=2&stockBajo=true` | 1 | 0 | 0.00 | 1 | 1 |
| `categoriaId=999` | 0 | 0 | 0.00 | 0 | 0 |

Para demostrar cambios en tiempo real, ejecuta en MySQL como administrador:

```sql
UPDATE inventario_soa.productos SET stock = 12 WHERE sku = 'PAP-002';
```

Vuelve a consultar stock bajo: el lápiz ya no debe aparecer. Para restaurar el ejemplo, cambia el stock a 5.

## 7. Ejecutar pruebas automatizadas

```powershell
npm.cmd test
```

Las pruebas usan `node:test`, un repositorio simulado y un servidor HTTP en un puerto temporal. Verifican cálculo exacto, stock en el límite, reporte vacío, validación, parámetros SQL y respuestas HTTP 200/400/404/500/503 sin exponer detalles internos.

Después de preparar MySQL y configurar `.env`, ejecuta la integración real:

```powershell
npm.cmd run test:integration
```

Esta prueba inicia su propio servidor HTTP en un puerto temporal, comprueba `/health` y compara cinco consultas del reporte contra totales calculados directamente por MySQL. Utiliza los datos existentes y no modifica registros; evita cambiar el inventario mientras corre. No necesitas ejecutar `npm start` antes. Si falla con `ER_ACCESS_DENIED_ERROR`, revisa la contraseña y los permisos del usuario de `.env` siguiendo el paso 3. Para verificar también los valores del ejemplo, sigue los pasos 3 a 6 y compara la tabla de resultados.

## 8. Explicar el código en clase

1. [src/server.js](src/server.js) inicia HTTP y configura el cierre del servicio.
2. [src/db.js](src/db.js) crea un pool reutilizable a partir de variables de entorno.
3. [src/app.js](src/app.js) conecta rutas y centraliza errores.
4. [src/routes/report.routes.js](src/routes/report.routes.js) recibe el GET y devuelve JSON.
5. [src/services/report.service.js](src/services/report.service.js) valida filtros y calcula el reporte con enteros de precisión arbitraria para dinero.
6. [src/repositories/inventory.repository.js](src/repositories/inventory.repository.js) obtiene productos con consultas parametrizadas para evitar interpolar entrada del cliente en SQL.

## 9. Llevarlo a otra máquina e integrar otros servicios

### Ejecutar todo con Docker

En la máquina de destino instala Docker con Compose (en Windows, Docker Desktop con contenedores Linux). Copia el proyecto con `package-lock.json`, `Dockerfile`, `compose.yaml`, `src/` y `sql/`; no necesitas copiar `node_modules` ni instalar Node o MySQL allí. En una copia nueva:

```powershell
Copy-Item .env.example .env
docker compose up -d --build --wait
```

Si `.env` ya existe, edítalo sin sobrescribirlo. Si hay otro MySQL local, usa `DB_PORT=3307`. Si otro servicio usa el puerto 3000, usa, por ejemplo, `PORT=3001`. Compose inicia la API y MySQL y espera a que `/health` responda correctamente. No ejecutes también `npm run dev` en el mismo puerto.

El contenedor de la API recibe sus variables desde Compose; `.env` no se copia a la imagen. La conexión interna utiliza `DB_HOST=db`, puerto 3306 y base `inventario_soa`, que es la base creada por los scripts SQL. `DB_USER` y `DB_PASSWORD` se aplican a ambos contenedores. Cambiar estas variables no cambia usuarios de un volumen MySQL ya inicializado: en ese caso conserva las credenciales originales o actualiza el usuario en MySQL.

```powershell
docker compose ps
docker compose logs api
Invoke-RestMethod 'http://localhost:3000/health'
```

Usa el puerto que hayas configurado en `PORT`. El volumen conserva los datos al reiniciar. Copiar el proyecto a otra máquina crea una base nueva con los datos de ejemplo; para trasladar datos existentes debes exportarlos e importarlos por separado.

### URL que deben usar tus compañeros

Si la máquina que aloja la API tiene, por ejemplo, la IP `192.168.1.50` y publicaste el puerto 3000, desde otra máquina en la misma red pueden probar:

```powershell
Invoke-RestMethod 'http://192.168.1.50:3000/api/v1/reportes/inventario' | ConvertTo-Json -Depth 10
```

Obtén la IPv4 del adaptador de red con `ipconfig` en la máquina anfitriona. Permite el puerto TCP de la API en el firewall para la red privada de la práctica. `localhost` siempre apunta a la máquina o contenedor que hace la solicitud; tus compañeros deben usar la IP o el nombre DNS del anfitrión. `0.0.0.0` es una dirección de escucha, no la URL del cliente. Para máquinas en redes diferentes necesitarán una red común/VPN o un servidor accesible.

| Consumidor | URL base de ejemplo |
|---|---|
| Programa en la misma máquina anfitriona | `http://localhost:3000` |
| Programa en otra máquina de la red | `http://192.168.1.50:3000` |
| Otro contenedor en la misma red de este Compose | `http://api:3000` |

Los contenedores de proyectos Compose distintos no comparten automáticamente una red. Al unir los proyectos, conecten los servicios a una red Docker compartida y acuerden nombres únicos. El nombre `api` solo se resuelve dentro de la red Docker correspondiente.

### Consumirlo desde otro servicio Node.js

El equipo consumidor configura `REPORTES_URL=http://192.168.1.50:3000` en su entorno y utiliza:

```javascript
const baseUrl = process.env.REPORTES_URL;
if (!baseUrl) throw new Error('Falta REPORTES_URL');
const url = new URL('/api/v1/reportes/inventario', baseUrl);
url.searchParams.set('stockBajo', 'true');
const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
if (!response.ok) throw new Error(`Reportes respondió HTTP ${response.status}`);
const { data } = await response.json();
console.log(data.resumen);
```

El consumidor debe manejar errores de conexión y respuestas no exitosas. Para llamadas entre servicios no hace falta CORS. Si una página web hace llamadas directas desde otro origen, habrá que configurar los orígenes permitidos o servirla mediante un gateway del mismo origen.

Acuerden como contrato la ruta `/api/v1/reportes/inventario`, sus filtros y el JSON del paso 5; los importes son cadenas con dos decimales. Los consumidores del reporte solo necesitan la URL HTTP. Este servicio todavía lee las tablas MySQL definidas en `sql/01-schema.sql`: el equipo debe acordar dónde se actualiza ese inventario. Si el servicio de inventario es dueño de una base privada y expone sus datos por REST, habrá que adaptar el repositorio para consumir su API cuando tengan ese contrato; trasladar los contenedores no conecta automáticamente esas fuentes de datos.

## Alcance y solución de problemas

- `ECONNREFUSED`: verifica que MySQL esté activo y que host y puerto coincidan.
- `Access denied`: revisa usuario, contraseña y permisos en MySQL.
- `Unknown database` o tablas inexistentes: ejecuta ambos scripts SQL en orden.
- `EADDRINUSE`: cambia `PORT` en `.env` y usa ese puerto al probar.
- `docker` o `mysql` no se reconoce: instala la herramienta o usa MySQL Workbench. Node.js por sí solo no incluye MySQL.

Esta versión académica devuelve todos los productos coincidentes en memoria y no incluye autenticación. Para desplegarla con datos reales, añade autenticación/autorización, HTTPS, límites de solicitudes y una estrategia de paginación o exportación para reportes grandes, conservando el cálculo de totales sobre el conjunto completo.
